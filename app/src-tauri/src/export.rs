//! Export of one run to xlsx with live formulas. Formulas match `calculation.rs`.

use std::path::{Path, PathBuf};

use chrono::{Local, TimeZone};
use rust_xlsxwriter::{Chart, ChartType, Format, FormatAlign, FormatScript, Formula, Workbook, Worksheet, XlsxError};

use crate::calculation::{RunResult, Series};
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

/// Writes label; text in braces is subscript, e.g. "CO{2} capacity".
fn write_label(sheet: &mut Worksheet, row: u32, column: u16, text: &str, base: &Format) -> Result<(), XlsxError> {
    if !text.contains('{') {
        sheet.write_string_with_format(row, column, text, base)?;
        return Ok(());
    }
    let subscript = base.clone().set_font_script(FormatScript::Subscript);
    let mut segments: Vec<(&Format, &str)> = Vec::new();
    for (index, part) in text.split(['{', '}']).enumerate() {
        if !part.is_empty() {
            segments.push((if index % 2 == 1 { &subscript } else { base }, part));
        }
    }
    sheet.write_rich_string(row, column, &segments)?;
    Ok(())
}

/// Result row of Summary sheet. Braces in label mark subscript; name is defined name for later formulas.
struct ResultRow<'a> {
    row: u32,
    label: &'a str,
    formula: String,
    value: f64,
    unit: &'a str,
    name: Option<&'a str>,
}

impl<'a> ResultRow<'a> {
    fn new(row: u32, label: &'a str, formula: String, value: f64, unit: &'a str, name: Option<&'a str>) -> Self {
        Self { row, label, formula, value, unit, name }
    }
}

fn number_or_empty(value: f64) -> String {
    if value.is_finite() { value.to_string() } else { String::new() }
}

pub struct ExportInput<'a> {
    pub run: &'a Run,
    pub measurements: &'a Measurements,
    pub result: &'a RunResult,
    pub blank_label: Option<String>,
    /// Write cached formula results; disable in tests to force recalculation.
    pub cached_results: bool,
}

pub fn write_workbook(path: &Path, input: &ExportInput) -> Result<(), XlsxError> {
    let run = input.run;
    let parameters = &run.parameters;
    let result = input.result;
    let series = Series::from_measurements(run, input.measurements);
    let row_count = series.times.len() as u32;
    let last_row = row_count + 1;

    let mut workbook = Workbook::new();
    let plain = Format::new();
    let bold = Format::new().set_bold();
    let header = Format::new().set_bold().set_text_wrap().set_align(FormatAlign::Top);
    let date_format = Format::new().set_num_format("yyyy-mm-dd hh:mm:ss");
    let cached = |formula: Formula, value: f64| {
        if input.cached_results { formula.set_result(number_or_empty(value)) } else { formula }
    };

    // ======[ Summary Sheet ]======
    let summary = workbook.add_worksheet().set_name("Summary")?;
    summary.set_column_width(0, 34)?;
    summary.set_column_width(1, 20)?;
    summary.set_column_width(2, 10)?;
    summary.set_column_width(3, 30)?;

    let status = match run.status {
        RunStatus::Running => "Running",
        RunStatus::Finished => "Finished",
        RunStatus::Aborted => "Aborted",
    };
    let text_rows =
        [("Sample", parameters.sample.as_str()), ("Operator", parameters.operator.as_str()), ("Status", status)];
    for (row, (label, value)) in text_rows.iter().enumerate() {
        summary.write_string_with_format(row as u32, 0, *label, &bold)?;
        summary.write_string(row as u32, 1, *value)?;
    }
    summary.write_string_with_format(3, 0, "Start", &bold)?;
    summary.write_number_with_format(3, 1, excel_date(run.started_at), &date_format)?;
    summary.write_string_with_format(4, 0, "Finish", &bold)?;
    if let Some(finished_at) = run.finished_at {
        summary.write_number_with_format(4, 1, excel_date(finished_at), &date_format)?;
    }
    summary.write_string_with_format(5, 0, "Note", &bold)?;
    summary.write_string(5, 1, &parameters.note)?;

    summary.write_string_with_format(7, 0, "Input", &bold)?;
    summary.write_string_with_format(7, 1, "Value", &bold)?;
    summary.write_string_with_format(7, 2, "Unit", &bold)?;
    summary.write_string(8, 0, "Nominal flow rate")?;
    summary.write_number(8, 1, parameters.flow_rate_ml_min)?;
    summary.write_string(8, 2, "mL/min")?;
    for index in 0..5u32 {
        summary.write_string(9 + index, 0, format!("Flow measurement {}", index + 1))?;
        if let Some(value) = parameters.flow_measurements.get(index as usize) {
            summary.write_number(9 + index, 1, *value)?;
        }
        summary.write_string(9 + index, 2, "mL/min")?;
    }
    summary.write_string(14, 0, "Flow rate")?;
    summary.write_formula(
        14,
        1,
        cached(Formula::new("=IF(COUNT(B10:B14)>0,AVERAGE(B10:B14),B9)"), result.flow_rate_ml_min),
    )?;
    summary.write_string(14, 2, "mL/min")?;

    let inputs = [
        (15, "Sorbent mass", parameters.mass_g, "g", "SampleMass"),
        (16, "Sorbent density", parameters.density_g_ml, "g/mL", "Density"),
        (17, "Pressure", parameters.pressure_bar, "bar", "Pressure"),
        (18, "Temperature", parameters.temperature_c, "°C", "Temperature"),
        (19, "Delay time", parameters.delay_s, "s", "DelayTime"),
        (20, "Baseline window", parameters.baseline_window_s, "s", "BaselineWindow"),
        (21, "C{0} window", parameters.co_window_s, "s", "CoWindow"),
        (22, "Blank time", result.blank_time_s, "s", "BlankTime"),
        (23, "Conversion scale", run.conversion_scale, "ppmv", "ConversionScale"),
        (24, "Conversion exponent", run.conversion_exponent, "", "ConversionExponent"),
    ];
    let mut names = vec![("FlowRate", "=Summary!$B$15".to_string())];
    for (row, label, value, unit, name) in inputs {
        write_label(summary, row, 0, label, &plain)?;
        summary.write_number(row, 1, value)?;
        summary.write_string(row, 2, unit)?;
        names.push((name, format!("=Summary!$B${}", row + 1)));
    }
    if let Some(label) = &input.blank_label {
        summary.write_string(22, 3, label)?;
    }

    summary.write_string_with_format(26, 0, "Result", &bold)?;
    summary.write_string_with_format(26, 1, "Value", &bold)?;
    summary.write_string_with_format(26, 2, "Unit", &bold)?;
    let outputs = [
        ResultRow::new(27, "Samples", "=COUNT(Data!A:A)".into(), result.sample_count as f64, "", None),
        ResultRow::new(28, "End time", "=MAX(Data!A:A)".into(), result.end_time_s, "s", Some("EndTime")),
        ResultRow::new(
            29,
            "Baseline",
            "=AVERAGEIFS(Data!D:D,Data!A:A,\"<=\"&BaselineWindow)".into(),
            result.baseline_ppm,
            "ppmv",
            Some("Baseline"),
        ),
        ResultRow::new(
            30,
            "C{0}",
            "=AVERAGEIFS(Data!D:D,Data!A:A,\">=\"&(EndTime-CoWindow))-Baseline".into(),
            result.co_ppm,
            "ppmv",
            Some("InletCO2"),
        ),
        ResultRow::new(31, "GHSV", "=FlowRate*60/(SampleMass/Density)".into(), result.ghsv_per_h, "1/h", None),
        ResultRow::new(32, "Retention time", "=3600/B32".into(), result.retention_time_s, "s", None),
        ResultRow::new(33, "T{b}", "=EndTime-DelayTime".into(), result.tb_s, "s", Some("AdsorptionTime")),
        ResultRow::new(
            34,
            "Total volume for T{b}",
            "=FlowRate*AdsorptionTime/60/1000".into(),
            result.total_volume_l,
            "L",
            None,
        ),
        ResultRow::new(
            35,
            "Total CO{2} volume for T{b}",
            "=B35*InletCO2*10^-6".into(),
            result.co2_volume_in_l,
            "L",
            None,
        ),
        ResultRow::new(
            36,
            "Stoichiometric time",
            "=SUM(Data!H:H)".into(),
            result.stoichiometric_time_s,
            "s",
            Some("StoichiometricTime"),
        ),
        ResultRow::new(
            37,
            "CO{2} volume adsorbed",
            "=FlowRate/60/1000*InletCO2*10^-6*(StoichiometricTime-BlankTime)".into(),
            result.adsorbed_volume_l,
            "L",
            None,
        ),
        ResultRow::new(
            38,
            "CO{2} adsorbed",
            "=B38*Pressure/0.08206/(Temperature+273.15)".into(),
            result.adsorbed_mol,
            "mol",
            None,
        ),
        ResultRow::new(39, "CO{2} capacity", "=1000*B39*44.01/SampleMass".into(), result.capacity_mg_g, "mg/g", None),
        ResultRow::new(40, "CO{2} capacity", "=1000*B39/SampleMass".into(), result.capacity_mmol_g, "mmol/g", None),
        ResultRow::new(
            41,
            "Breakthrough time (C/C{0} = 0.05)",
            format!(
                "=IFERROR(INDEX(Data!A2:A{last_row},MATCH(1,INDEX((Data!A2:A{last_row}>DelayTime)*(Data!F2:F{last_row}/InletCO2>=0.05),0),0))-DelayTime,\"\")"
            ),
            result.breakthrough_time_s.unwrap_or(f64::NAN),
            "s",
            None,
        ),
    ];
    for ResultRow { row, label, formula, value, unit, name } in outputs {
        write_label(summary, row, 0, label, &plain)?;
        let number_format = match unit {
            "" => "0",
            "ppmv" | "1/h" => "#,##0",
            "s" => "0.0",
            "L" | "mol" => "0.000000",
            "mg/g" => "0.00",
            _ => "0.000",
        };
        summary.write_formula_with_format(
            row,
            1,
            cached(Formula::new(formula), value),
            &Format::new().set_num_format(number_format),
        )?;
        summary.write_string(row, 2, unit)?;
        if let Some(name) = name {
            names.push((name, format!("=Summary!$B${}", row + 1)));
        }
    }

    // ======[ Data Sheet ]======
    let data = workbook.add_worksheet().set_name("Data")?;
    let headers =
        ["t (s)", "Time", "N", "CO{2} (ppmv)", "Δt (s)", "C − baseline (ppmv)", "C/C{0}", "(1 − C/C{0})·Δt (s)"];
    for (column, title) in headers.iter().enumerate() {
        write_label(data, 0, column as u16, title, &header)?;
    }
    data.set_column_width(1, 20)?;
    data.set_column_width(5, 12)?;
    data.set_freeze_panes(1, 0)?;
    let mut previous_time = 0.0;
    for index in 0..series.times.len() {
        let row = index as u32 + 1;
        let excel_row = row + 1;
        let time = series.times[index];
        let value = series.concentrations[index];
        data.write_number(row, 0, time)?;
        data.write_number_with_format(row, 1, excel_date(input.measurements.timestamps[index]), &date_format)?;
        data.write_number(row, 2, f64::from(input.measurements.counts[index]))?;
        data.write_formula(
            row,
            3,
            cached(Formula::new(format!("=ConversionScale*EXP(ConversionExponent*C{excel_row})")), value),
        )?;
        let previous_reference = if row == 1 { "0".to_string() } else { format!("A{}", excel_row - 1) };
        let interval = if time > parameters.delay_s { time - f64::max(previous_time, parameters.delay_s) } else { 0.0 };
        data.write_formula(
            row,
            4,
            cached(
                Formula::new(format!("=IF(A{excel_row}>DelayTime,A{excel_row}-MAX({previous_reference},DelayTime),0)")),
                interval,
            ),
        )?;
        let above_baseline = value - result.baseline_ppm;
        data.write_formula(row, 5, cached(Formula::new(format!("=D{excel_row}-Baseline")), above_baseline))?;
        let ratio = if time > parameters.delay_s { above_baseline / result.co_ppm } else { f64::NAN };
        data.write_formula(
            row,
            6,
            cached(Formula::new(format!("=IF(A{excel_row}>DelayTime,F{excel_row}/InletCO2,\"\")")), ratio),
        )?;
        let weighted = if time > parameters.delay_s { interval * (1.0 - ratio) } else { 0.0 };
        data.write_formula(
            row,
            7,
            cached(Formula::new(format!("=IF(A{excel_row}>DelayTime,E{excel_row}*(1-G{excel_row}),0)")), weighted),
        )?;
        previous_time = time;
    }

    // ======[ Chart ]======
    if row_count > 0 {
        let mut chart = Chart::new(ChartType::ScatterStraight);
        chart
            .add_series()
            .set_categories(("Data", 1, 0, row_count, 0))
            .set_values(("Data", 1, 3, row_count, 3))
            .set_name("CO₂");
        chart.title().set_hidden();
        chart.legend().set_hidden();
        chart.x_axis().set_name("t (s)");
        chart.y_axis().set_name("CO₂ (ppmv)");
        chart.set_width(720).set_height(420);
        let summary = workbook.worksheet_from_name("Summary")?;
        summary.insert_chart(0, 4, &chart)?;
    }

    for (name, reference) in names {
        workbook.define_name(name, &reference)?;
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
                baseline_window_s: 10.0,
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
        write_workbook(
            &path,
            &ExportInput {
                run: &run,
                measurements: &measurements,
                result: &result,
                blank_label: None,
                cached_results: true,
            },
        )
        .unwrap();
        assert!(path.metadata().unwrap().len() > 1000);
    }
}
