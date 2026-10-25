//! Export of runs to xlsx with live formulas, one sheet per run, in style of `CO2 capture calculation standard.xlsx`.
//! Formulas match `calculation.rs`.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use chrono::{Local, TimeZone};
use rust_xlsxwriter::{
    Chart, ChartType, Color, Format, FormatAlign, FormatBorder, FormatScript, Formula, Workbook, Worksheet, XlsxError,
};

use crate::calculation::{RunResult, Series, soap_flow_rate};
use crate::model::{Measurements, Run, RunStatus};

/// Converts Unix time (ms) to Excel serial date in local time.
fn excel_date(timestamp: i64) -> f64 {
    let local = Local.timestamp_millis_opt(timestamp).single().map(|date| date.naive_local());
    let Some(local) = local else { return 0.0 };
    let epoch = chrono::NaiveDate::from_ymd_opt(1899, 12, 30).unwrap().and_hms_opt(0, 0, 0).unwrap();
    (local - epoch).num_milliseconds() as f64 / 86_400_000.0
}

/// Device names that Windows does not allow as file names, with or without extension.
const RESERVED_NAMES: [&str; 22] = [
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9", "LPT1", "LPT2",
    "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

fn sanitize(text: &str) -> String {
    let cleaned: String = text
        .chars()
        .map(|character| if r#"\/:*?"<>|"#.contains(character) || character.is_control() { '_' } else { character })
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').to_string();
    if trimmed.is_empty() {
        return "run".into();
    }
    let stem = trimmed.split('.').next().unwrap_or_default().to_ascii_uppercase();
    if RESERVED_NAMES.contains(&stem.as_str()) { format!("{trimmed}_") } else { trimmed }
}

/// Builds file name from pattern; placeholders: {date}, {time}, {sample}, {operator}, {id}.
pub fn file_name(pattern: &str, run: &Run) -> String {
    let started = Local.timestamp_millis_opt(run.started_at).single().unwrap_or_else(Local::now);
    let name = pattern
        .replace("{date}", &started.format("%Y-%m-%d").to_string())
        .replace("{time}", &started.format("%H%M").to_string())
        .replace("{sample}", &run.parameters.sample)
        .replace("{operator}", &run.parameters.operator)
        .replace("{id}", &run.id.to_string());
    sanitize(&name)
}

/// Returns path in folder that does not exist yet: name.xlsx, name-2.xlsx, ...
pub fn unique_path(folder: &Path, name: &str) -> PathBuf {
    let mut path = folder.join(format!("{name}.xlsx"));
    let mut index = 2;
    while path.exists() {
        path = folder.join(format!("{name}-{index}.xlsx"));
        index += 1;
    }
    path
}

/// Writes text; text in braces is subscript, e.g. "CO{2} capacity". Format gives font, fill and border.
fn write_label(sheet: &mut Worksheet, row: u32, column: u16, text: &str, format: &Format) -> Result<(), XlsxError> {
    if !text.contains('{') {
        sheet.write_string_with_format(row, column, text, format)?;
        return Ok(());
    }
    let subscript = format.clone().set_font_script(FormatScript::Subscript);
    let mut segments: Vec<(&Format, &str)> = Vec::new();
    for (index, part) in text.split(['{', '}']).enumerate() {
        if !part.is_empty() {
            segments.push((if index % 2 == 1 { &subscript } else { format }, part));
        }
    }
    sheet.write_rich_string_with_format(row, column, &segments, format)?;
    Ok(())
}

fn number_or_empty(value: f64) -> String {
    if value.is_finite() { value.to_string() } else { String::new() }
}

/// Excel sheet name "date_sample": at most 31 characters, without characters Excel does not allow, unique in workbook.
fn sheet_name(run: &Run, used: &mut HashSet<String>) -> String {
    let started = Local.timestamp_millis_opt(run.started_at).single().unwrap_or_else(Local::now);
    let sample: String = run
        .parameters
        .sample
        .chars()
        .map(|character| if r"[]:*?/\'".contains(character) || character.is_control() { '_' } else { character })
        .collect();
    let base: String = format!("{}_{}", started.format("%Y-%m-%d"), sample.trim()).chars().take(31).collect();
    let mut name = base.clone();
    let mut index = 2;
    while used.contains(&name.to_lowercase()) {
        let suffix = format!(" ({index})");
        name = format!("{}{suffix}", base.chars().take(31 - suffix.len()).collect::<String>());
        index += 1;
    }
    used.insert(name.to_lowercase());
    name
}

pub struct ExportInput<'a> {
    pub run: &'a Run,
    pub measurements: &'a Measurements,
    pub result: &'a RunResult,
    pub blank_label: Option<String>,
    /// Write cached formula results; disable in tests to force recalculation.
    pub cached_results: bool,
}

// ======[ Style Of Original Workbook ]======
const YELLOW: u32 = 0xFFFFCC;
const GREEN: u32 = 0xE2EFDA;
const ORANGE: u32 = 0xFBE5D6;
const RED: u32 = 0xC00000;
const DATA_FONT: &str = "Times New Roman";
const BLOCK_FONT: &str = "Arial";

/// Cell formats of one sheet.
struct Styles {
    data_header: Format,
    data: Format,
    data_clock: Format,
    calculated: Format,
    box_label: Format,
    box_value: Format,
    box_date: Format,
    block_header: Format,
    input_group: Format,
    input: Format,
    input_label: Format,
    calculated_group: Format,
    block: Format,
    block_label: Format,
    capacity: Format,
    note: Format,
}

impl Styles {
    fn new() -> Self {
        let data = Format::new()
            .set_font_name(DATA_FONT)
            .set_font_size(14)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);
        let block = Format::new()
            .set_font_name(BLOCK_FONT)
            .set_font_size(12)
            .set_align(FormatAlign::Center)
            .set_align(FormatAlign::VerticalCenter)
            .set_border(FormatBorder::Thin);
        let input = block.clone().set_background_color(Color::RGB(GREEN));
        let box_cell =
            Format::new().set_font_name(BLOCK_FONT).set_font_size(12).set_background_color(Color::RGB(YELLOW));
        Self {
            data_header: data.clone().set_bold().set_text_wrap().set_background_color(Color::RGB(YELLOW)),
            data_clock: data.clone().set_num_format("hh:mm:ss"),
            calculated: data.clone().set_background_color(Color::RGB(ORANGE)),
            data,
            box_label: box_cell.clone().set_bold().set_align(FormatAlign::Right),
            box_value: box_cell.clone().set_font_color(Color::RGB(RED)).set_align(FormatAlign::Left),
            box_date: box_cell
                .set_font_color(Color::RGB(RED))
                .set_align(FormatAlign::Left)
                .set_num_format("yyyy-mm-dd hh:mm"),
            block_header: block.clone().set_bold().set_background_color(Color::RGB(YELLOW)),
            input_group: input.clone().set_bold().set_text_wrap(),
            input_label: input.clone().set_align(FormatAlign::Left),
            note: input.clone().set_text_wrap(),
            input,
            calculated_group: block.clone().set_bold().set_text_wrap(),
            block_label: block.clone().set_align(FormatAlign::Left),
            capacity: block.clone().set_font_color(Color::RGB(RED)),
            block,
        }
    }
}

/// Number format of value by unit.
fn unit_format(unit: &str) -> &'static str {
    match unit {
        "" => "0",
        "ppmv" | "1/h" => "#,##0",
        "s" => "0.0",
        "L" | "mol" => "0.000000",
        "mg/g" | "mL/min" => "0.00",
        _ => "0.0000",
    }
}

/// Row of parameter block: label (braces mark subscript), live formula or input value, unit, and local defined name.
struct BlockRow<'a> {
    label: &'a str,
    formula: Option<String>,
    value: f64,
    unit: &'a str,
    name: Option<&'a str>,
}

impl<'a> BlockRow<'a> {
    fn input(label: &'a str, value: f64, unit: &'a str, name: &'a str) -> Self {
        Self { label, formula: None, value, unit, name: Some(name) }
    }

    fn formula(label: &'a str, formula: String, value: f64, unit: &'a str, name: Option<&'a str>) -> Self {
        Self { label, formula: Some(formula), value, unit, name }
    }
}

// Columns: data A to H, parameter block J to N, soap film times P to R, chart from T
const BLOCK_GROUP: u16 = 9;
const BLOCK_LABEL: u16 = 10;
const BLOCK_VALUE: u16 = 11;
const BLOCK_UNIT: u16 = 12;
const BLOCK_NOTE: u16 = 13;
const SOAP_INDEX: u16 = 15;
const SOAP_TIME: u16 = 16;
const SOAP_FLOW: u16 = 17;
const CHART_COLUMN: u16 = 19;
/// First row of parameter table (0-based); header is row above.
const TABLE_ROW: u32 = 7;

/// Writes one run to new sheet of workbook.
fn write_run_sheet(workbook: &mut Workbook, input: &ExportInput, name: &str) -> Result<(), XlsxError> {
    let run = input.run;
    let parameters = &run.parameters;
    let result = input.result;
    let series = Series::from_measurements(run, input.measurements);
    let row_count = series.times.len() as u32;
    let last_row = row_count + 1;
    let styles = Styles::new();
    let cached = |formula: Formula, value: f64| {
        if input.cached_results { formula.set_result(number_or_empty(value)) } else { formula }
    };
    // Local defined names of this sheet, e.g. 'Sheet name'!FlowRate
    let quoted = format!("'{name}'");
    let mut names: Vec<(String, String)> = Vec::new();
    let mut define = |local: &str, row: u32, column: u16| {
        let reference = format!("={quoted}!${}${}", column_letter(column), row + 1);
        names.push((format!("{quoted}!{local}"), reference));
    };

    let sheet = workbook.add_worksheet().set_name(name)?;
    for (column, width) in [
        (0, 9.0),
        (1, 13.0),
        (2, 7.0),
        (3, 14.0),
        (4, 9.0),
        (5, 15.0),
        (6, 10.0),
        (7, 16.0),
        (8, 3.0),
        (BLOCK_GROUP, 17.0),
        (BLOCK_LABEL, 34.0),
        (BLOCK_VALUE, 14.0),
        (BLOCK_UNIT, 11.0),
        (BLOCK_NOTE, 27.0),
        (14, 3.0),
        (SOAP_INDEX, 6.0),
        (SOAP_TIME, 11.0),
        (SOAP_FLOW, 19.0),
    ] {
        sheet.set_column_width(column, width)?;
    }

    // ======[ Sample Box ]======
    let status = match run.status {
        RunStatus::Running => "Running",
        RunStatus::Finished => "Finished",
        RunStatus::Aborted => "Aborted",
    };
    sheet.write_string_with_format(1, BLOCK_GROUP, "Sample:", &styles.box_label)?;
    sheet.write_string_with_format(1, BLOCK_LABEL, &parameters.sample, &styles.box_value)?;
    sheet.write_string_with_format(2, BLOCK_GROUP, "Date:", &styles.box_label)?;
    sheet.write_number_with_format(2, BLOCK_LABEL, excel_date(run.started_at), &styles.box_date)?;
    sheet.write_string_with_format(3, BLOCK_GROUP, "Operator:", &styles.box_label)?;
    sheet.write_string_with_format(3, BLOCK_LABEL, &parameters.operator, &styles.box_value)?;
    sheet.write_string_with_format(4, BLOCK_GROUP, "Status:", &styles.box_label)?;
    sheet.write_string_with_format(4, BLOCK_LABEL, status, &styles.box_value)?;

    // ======[ Soap Film Times ]======
    let header_row = TABLE_ROW - 1;
    sheet.write_string_with_format(header_row, SOAP_INDEX, "No.", &styles.block_header)?;
    sheet.write_string_with_format(header_row, SOAP_TIME, "Time (s)", &styles.block_header)?;
    sheet.write_string_with_format(header_row, SOAP_FLOW, "Flow rate (mL/min)", &styles.block_header)?;
    let soap_rows = parameters.soap_times_s.len().max(parameters.flow_measurements.len()).max(1) as u32;
    for index in 0..soap_rows {
        let row = TABLE_ROW + index;
        sheet.write_number_with_format(row, SOAP_INDEX, f64::from(index + 1), &styles.block)?;
        let flow_format = styles.block.clone().set_num_format("0.00");
        if let Some(time) = parameters.soap_times_s.get(index as usize) {
            sheet.write_number_with_format(row, SOAP_TIME, *time, &styles.input)?;
            let flow = soap_flow_rate(parameters.soap_volume_ml, *time);
            let formula = Formula::new(format!("=60*SoapVolume/{}{}", column_letter(SOAP_TIME), row + 1));
            sheet.write_formula_with_format(row, SOAP_FLOW, cached(formula, flow), &flow_format)?;
        } else {
            sheet.write_blank(row, SOAP_TIME, &styles.input)?;
            // Runs of earlier versions have flow rates without times
            match parameters.flow_measurements.get(index as usize).filter(|_| parameters.soap_times_s.is_empty()) {
                Some(flow) => sheet.write_number_with_format(row, SOAP_FLOW, *flow, &flow_format)?,
                None => sheet.write_blank(row, SOAP_FLOW, &flow_format)?,
            };
        }
    }
    let flow_column = column_letter(SOAP_FLOW);
    let flow_range = format!("{flow_column}{}:{flow_column}{}", TABLE_ROW + 1, TABLE_ROW + soap_rows);

    // ======[ Parameter Table ]======
    for (column, title) in [
        (BLOCK_GROUP, " "),
        (BLOCK_LABEL, "Parameter"),
        (BLOCK_VALUE, "Value"),
        (BLOCK_UNIT, "Unit"),
        (BLOCK_NOTE, "Note"),
    ] {
        sheet.write_string_with_format(header_row, column, title, &styles.block_header)?;
    }
    let nominal = parameters.flow_rate_ml_min > 0.0;
    let mut inputs = vec![BlockRow::input("Soap film volume", parameters.soap_volume_ml, "mL", "SoapVolume")];
    if nominal {
        inputs.push(BlockRow::input("Nominal flow rate", parameters.flow_rate_ml_min, "mL/min", "NominalFlowRate"));
    }
    inputs.extend([
        BlockRow::input("Mass of sorbent", parameters.mass_g, "g", "SampleMass"),
        BlockRow::input("Density of sorbent", parameters.density_g_ml, "g/mL", "Density"),
        BlockRow::input("Pressure", parameters.pressure_bar, "bar", "Pressure"),
        BlockRow::input("Temperature", parameters.temperature_c, "°C", "Temperature"),
        BlockRow::input("Delay time", parameters.delay_s, "s", "DelayTime"),
        BlockRow::input("C{0} window", parameters.co_window_s, "s", "CoWindow"),
        BlockRow::input("Blank time", result.blank_time_s, "s", "BlankTime"),
        BlockRow::input("Conversion scale", run.conversion_scale, "ppmv", "ConversionScale"),
        BlockRow::input("Conversion exponent", run.conversion_exponent, "", "ConversionExponent"),
    ]);
    let fallback = if nominal { "NominalFlowRate" } else { "NA()" };
    let outputs = [
        BlockRow::formula(
            "Flow rate",
            format!("=IF(COUNT({flow_range})>0,AVERAGE({flow_range}),{fallback})"),
            result.flow_rate_ml_min,
            "mL/min",
            Some("FlowRate"),
        ),
        BlockRow::formula("Samples", "=COUNT(A:A)".into(), result.sample_count as f64, "", None),
        BlockRow::formula("End time", "=MAX(A:A)".into(), result.end_time_s, "s", Some("EndTime")),
        BlockRow::formula("Baseline", "=MIN(D:D)".into(), result.baseline_ppm, "ppmv", Some("Baseline")),
        BlockRow::formula(
            "C{0}",
            "=AVERAGEIFS(D:D,A:A,\">=\"&(EndTime-CoWindow))-Baseline".into(),
            result.co_ppm,
            "ppmv",
            Some("InletCO2"),
        ),
        BlockRow::formula("GHSV", "=FlowRate*60/(SampleMass/Density)".into(), result.ghsv_per_h, "1/h", Some("GHSV")),
        BlockRow::formula("Retention time", "=3600/GHSV".into(), result.retention_time_s, "s", None),
        BlockRow::formula("T{b}", "=EndTime-DelayTime".into(), result.tb_s, "s", Some("AdsorptionTime")),
        BlockRow::formula(
            "Total volume for T{b}",
            "=FlowRate*AdsorptionTime/60/1000".into(),
            result.total_volume_l,
            "L",
            Some("TotalVolume"),
        ),
        BlockRow::formula(
            "Total CO{2} volume for T{b}",
            "=TotalVolume*InletCO2*10^-6".into(),
            result.co2_volume_in_l,
            "L",
            None,
        ),
        BlockRow::formula(
            "Stoichiometric time",
            "=SUM(H:H)".into(),
            result.stoichiometric_time_s,
            "s",
            Some("StoichiometricTime"),
        ),
        BlockRow::formula(
            "CO{2} volume adsorbed",
            "=FlowRate/60/1000*InletCO2*10^-6*(StoichiometricTime-BlankTime)".into(),
            result.adsorbed_volume_l,
            "L",
            Some("AdsorbedVolume"),
        ),
        BlockRow::formula(
            "CO{2} adsorbed",
            "=AdsorbedVolume*Pressure/0.08206/(Temperature+273.15)".into(),
            result.adsorbed_mol,
            "mol",
            Some("AdsorbedMol"),
        ),
        BlockRow::formula(
            "CO{2} capacity",
            "=1000*AdsorbedMol*44.01/SampleMass".into(),
            result.capacity_mg_g,
            "mg/g",
            None,
        ),
        BlockRow::formula(
            "CO{2} capacity",
            "=1000*AdsorbedMol/SampleMass".into(),
            result.capacity_mmol_g,
            "mmol/g",
            None,
        ),
        BlockRow::formula(
            "Breakthrough time (C/C{0} = 0.05)",
            format!(
                "=IFERROR(INDEX(A2:A{last_row},MATCH(1,INDEX((A2:A{last_row}>DelayTime)*(F2:F{last_row}/InletCO2>=0.05),0),0))-DelayTime,\"\")"
            ),
            result.breakthrough_time_s.unwrap_or(f64::NAN),
            "s",
            None,
        ),
    ];

    let input_start = TABLE_ROW;
    for (index, row_data) in inputs.iter().enumerate() {
        let row = input_start + index as u32;
        write_label(sheet, row, BLOCK_LABEL, row_data.label, &styles.input_label)?;
        sheet.write_number_with_format(row, BLOCK_VALUE, row_data.value, &styles.input)?;
        sheet.write_string_with_format(row, BLOCK_UNIT, row_data.unit, &styles.input)?;
        if let Some(local) = row_data.name {
            define(local, row, BLOCK_VALUE);
        }
    }
    let input_end = input_start + inputs.len() as u32 - 1;
    sheet.merge_range(input_start, BLOCK_GROUP, input_end, BLOCK_GROUP, "INPUT DATA", &styles.input_group)?;
    // Note of run covers input rows above blank time; blank time row has label of blank run
    let blank_row = input_end - 2;
    sheet.merge_range(input_start, BLOCK_NOTE, blank_row - 1, BLOCK_NOTE, &parameters.note, &styles.note)?;
    sheet.write_string_with_format(blank_row, BLOCK_NOTE, input.blank_label.as_deref().unwrap_or(""), &styles.input)?;
    for row in blank_row + 1..=input_end {
        sheet.write_blank(row, BLOCK_NOTE, &styles.input)?;
    }

    let output_start = input_end + 1;
    for (index, row_data) in outputs.iter().enumerate() {
        let row = output_start + index as u32;
        let capacity = row_data.unit == "mg/g" || row_data.unit == "mmol/g";
        let base = if capacity { &styles.capacity } else { &styles.block };
        let value_format = base.clone().set_num_format(unit_format(row_data.unit));
        let formula = Formula::new(row_data.formula.clone().unwrap_or_default());
        sheet.write_formula_with_format(row, BLOCK_VALUE, cached(formula, row_data.value), &value_format)?;
        sheet.write_string_with_format(row, BLOCK_UNIT, row_data.unit, base)?;
        if row_data.unit == "mg/g" {
            // Capacity label covers rows of both units, as in original workbook
            sheet.merge_range(row, BLOCK_LABEL, row + 1, BLOCK_LABEL, "", &styles.capacity)?;
            write_label(sheet, row, BLOCK_LABEL, row_data.label, &styles.capacity)?;
            sheet.merge_range(row, BLOCK_NOTE, row + 1, BLOCK_NOTE, "", &styles.capacity)?;
        } else if row_data.unit != "mmol/g" {
            write_label(sheet, row, BLOCK_LABEL, row_data.label, &styles.block_label)?;
            if row_data.name == Some("InletCO2") {
                let percent = styles.block.clone().set_num_format("0.00%");
                sheet.write_formula_with_format(
                    row,
                    BLOCK_NOTE,
                    cached(Formula::new("=InletCO2*10^-6"), result.co_ppm * 1e-6),
                    &percent,
                )?;
            } else {
                sheet.write_blank(row, BLOCK_NOTE, &styles.block)?;
            }
        }
        if let Some(local) = row_data.name {
            define(local, row, BLOCK_VALUE);
        }
    }
    let output_end = output_start + outputs.len() as u32 - 1;
    sheet.merge_range(
        output_start,
        BLOCK_GROUP,
        output_end,
        BLOCK_GROUP,
        "CALCULATED DATA",
        &styles.calculated_group,
    )?;

    // ======[ Data ]======
    let headers =
        ["t (s)", "Time", "N", "CO{2} (ppmv)", "Δt (s)", "C − baseline (ppmv)", "C/C{0}", "(1 − C/C{0})·Δt (s)"];
    for (column, title) in headers.iter().enumerate() {
        write_label(sheet, 0, column as u16, title, &styles.data_header)?;
    }
    sheet.set_row_height(0, 42)?;
    sheet.set_freeze_panes(1, 0)?;
    let ratio_format = styles.calculated.clone().set_num_format("0.0000");
    let concentration_format = styles.data.clone().set_num_format("0.00");
    let above_format = styles.calculated.clone().set_num_format("0.00");
    let interval_format = styles.calculated.clone().set_num_format("0.000");
    let mut previous_time = 0.0;
    for index in 0..series.times.len() {
        let row = index as u32 + 1;
        let excel_row = row + 1;
        let time = series.times[index];
        let value = series.concentrations[index];
        sheet.write_number_with_format(row, 0, time, &styles.data)?;
        sheet.write_number_with_format(row, 1, excel_date(input.measurements.timestamps[index]), &styles.data_clock)?;
        sheet.write_number_with_format(row, 2, f64::from(input.measurements.counts[index]), &styles.data)?;
        sheet.write_formula_with_format(
            row,
            3,
            cached(Formula::new(format!("=ConversionScale*EXP(ConversionExponent*C{excel_row})")), value),
            &concentration_format,
        )?;
        let previous_reference = if row == 1 { "0".to_string() } else { format!("A{}", excel_row - 1) };
        let interval = if time > parameters.delay_s { time - f64::max(previous_time, parameters.delay_s) } else { 0.0 };
        sheet.write_formula_with_format(
            row,
            4,
            cached(
                Formula::new(format!("=IF(A{excel_row}>DelayTime,A{excel_row}-MAX({previous_reference},DelayTime),0)")),
                interval,
            ),
            &interval_format,
        )?;
        let above_baseline = value - result.baseline_ppm;
        sheet.write_formula_with_format(
            row,
            5,
            cached(Formula::new(format!("=D{excel_row}-Baseline")), above_baseline),
            &above_format,
        )?;
        let ratio = if time > parameters.delay_s { above_baseline / result.co_ppm } else { f64::NAN };
        sheet.write_formula_with_format(
            row,
            6,
            cached(Formula::new(format!("=IF(A{excel_row}>DelayTime,F{excel_row}/InletCO2,\"\")")), ratio),
            &ratio_format,
        )?;
        let weighted = if time > parameters.delay_s { interval * (1.0 - ratio) } else { 0.0 };
        sheet.write_formula_with_format(
            row,
            7,
            cached(Formula::new(format!("=IF(A{excel_row}>DelayTime,E{excel_row}*(1-G{excel_row}),0)")), weighted),
            &interval_format,
        )?;
        previous_time = time;
    }

    // ======[ Chart ]======
    if row_count > 0 {
        let mut chart = Chart::new(ChartType::ScatterStraight);
        chart
            .add_series()
            .set_categories((name, 1, 0, row_count, 0))
            .set_values((name, 1, 3, row_count, 3))
            .set_name("CO₂");
        chart.title().set_hidden();
        chart.legend().set_hidden();
        chart.x_axis().set_name("t (s)");
        chart.y_axis().set_name("CO₂ (ppmv)");
        chart.set_width(720).set_height(420);
        sheet.insert_chart(0, CHART_COLUMN, &chart)?;
    }

    for (local, reference) in names {
        workbook.define_name(local, &reference)?;
    }
    Ok(())
}

/// Column letter of 0-based column index (columns below 26 only).
fn column_letter(column: u16) -> char {
    char::from(b'A' + column as u8)
}

/// Writes workbook with one sheet per run.
pub fn write_workbook(path: &Path, inputs: &[ExportInput]) -> Result<(), XlsxError> {
    let mut workbook = Workbook::new();
    let mut used = HashSet::new();
    for input in inputs {
        let name = sheet_name(input.run, &mut used);
        write_run_sheet(&mut workbook, input, &name)?;
    }
    workbook.save(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::calculation::calculate;
    use crate::model::RunParameters;

    #[test]
    fn file_name_is_sanitized() {
        let run = Run {
            id: 7,
            status: RunStatus::Finished,
            started_at: 0,
            finished_at: None,
            conversion_scale: 1785.9,
            conversion_exponent: 0.0111,
            export_path: None,
            parameters: RunParameters { sample: "K/ZY: II".into(), ..Default::default() },
        };
        assert!(file_name("{sample}_{id}", &run).starts_with("K_ZY_ II_7"));
        assert_eq!(sanitize("con"), "con_");
        assert_eq!(sanitize("COM3.test"), "COM3.test_");
        assert_eq!(sanitize("COM30"), "COM30");
        let mut used = HashSet::new();
        let first = sheet_name(&run, &mut used);
        assert!(first.ends_with("_K_ZY_ II"), "{first}");
        assert_eq!(sheet_name(&run, &mut used), format!("{first} (2)"));
    }

    #[test]
    fn unique_path_does_not_overwrite() {
        let directory = tempfile::tempdir().unwrap();
        let first = unique_path(directory.path(), "run");
        std::fs::write(&first, b"x").unwrap();
        let second = unique_path(directory.path(), "run");
        assert_eq!(second.file_name().unwrap(), "run-2.xlsx");
    }

    #[test]
    fn writes_workbook() {
        let directory = tempfile::tempdir().unwrap();
        let run = Run {
            id: 1,
            status: RunStatus::Finished,
            started_at: 1_700_000_000_000,
            finished_at: Some(1_700_000_200_000),
            conversion_scale: 1785.9,
            conversion_exponent: 0.0111,
            export_path: None,
            parameters: RunParameters {
                sample: "Test".into(),
                flow_rate_ml_min: 60.0,
                mass_g: 1.0,
                density_g_ml: 1.0,
                pressure_bar: 1.0,
                temperature_c: 30.0,
                co_window_s: 10.0,
                ..Default::default()
            },
        };
        let measurements = Measurements {
            timestamps: (1..=200).map(|second| run.started_at + second * 1000).collect(),
            counts: (1..=200).map(|second| if second <= 100 { 30 } else { 260 }).collect(),
        };
        let series = Series::from_measurements(&run, &measurements);
        let result = calculate(&run, &series, 0.0);
        let path = directory.path().join("test.xlsx");
        let input = || ExportInput {
            run: &run,
            measurements: &measurements,
            result: &result,
            blank_label: None,
            cached_results: true,
        };
        // Two runs with same date and sample get separate sheet names
        write_workbook(&path, &[input(), input()]).unwrap();
        assert!(path.metadata().unwrap().len() > 1000);
    }
}
