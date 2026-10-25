//! Exports run from legacy KQ file without cached formula results, forcing recalculation, and prints Rust results as JSON.
//! Usage: cargo run --example export_check -- <legacy.txt> <output.xlsx> <delay_s> <blank_time_s>

use co2_monitor_lib::calculation::{Series, calculate};
use co2_monitor_lib::export::{ExportInput, write_workbook};
use co2_monitor_lib::model::{Measurements, Run, RunParameters, RunStatus};

fn main() {
    let arguments: Vec<String> = std::env::args().collect();
    let text = std::fs::read(&arguments[1]).unwrap();
    let text = String::from_utf8_lossy(&text);
    let delay_s: f64 = arguments[3].parse().unwrap();
    let blank_time_s: f64 = arguments[4].parse().unwrap();
    let started_at = 1_760_000_000_000i64;
    let mut measurements = Measurements::default();
    for line in text.lines() {
        let parts: Vec<&str> = line.split_whitespace().collect();
        if parts.len() < 2 {
            continue;
        }
        let (Ok(index), Ok(value)) = (parts[0].parse::<i64>(), parts[1].replace(',', ".").parse::<f64>()) else {
            continue;
        };
        // Skip samples 300 to 309 to simulate gap
        if (300..310).contains(&index) {
            continue;
        }
        let count = ((value / 1785.9).ln() / 0.0111).round() as u32;
        measurements.timestamps.push(started_at + index * 1000);
        measurements.counts.push(count);
    }
    let run = Run {
        id: 1,
        status: RunStatus::Finished,
        started_at,
        finished_at: measurements.timestamps.last().copied(),
        conversion_scale: 1785.9,
        conversion_exponent: 0.0111,
        export_path: None,
        parameters: RunParameters {
            sample: "Check".into(),
            flow_rate_ml_min: 60.0,
            flow_measurements: vec![59.0, 60.5, 61.0, 60.0, 59.5],
            mass_g: 0.56,
            density_g_ml: 1.0,
            pressure_bar: 1.0,
            temperature_c: 30.0,
            delay_s,
            baseline_window_s: 60.0,
            co_window_s: 300.0,
            ..Default::default()
        },
    };
    let series = Series::from_measurements(&run, &measurements);
    let result = calculate(&run, &series, blank_time_s);
    write_workbook(
        std::path::Path::new(&arguments[2]),
        &ExportInput {
            run: &run,
            measurements: &measurements,
            result: &result,
            blank_label: None,
            cached_results: false,
        },
    )
    .unwrap();
    println!("{}", serde_json::to_string(&result).unwrap());
}
