//! CO2 capacity from breakthrough curve.
//!
//! Same method as `CO2 capture calculation standard.xlsx`, with these changes:
//! baseline is mean over first `baseline_window_s` seconds instead of minimum,
//! Co is mean over last `co_window_s` seconds instead of maximum, time steps come from
//! real timestamps instead of row count, optional blank run is subtracted, and gas law
//! uses R = 0.08206 L atm/(mol K) and 273.15 K.
//! Exported workbook (`export.rs`) has same formulas; tests check both agree.

use serde::Serialize;

use crate::model::{Readings, Run};
use crate::protocol::concentration;

pub const GAS_CONSTANT: f64 = 0.08206;
pub const KELVIN_OFFSET: f64 = 273.15;
pub const CO2_MOLAR_MASS: f64 = 44.01;
pub const BREAKTHROUGH_FRACTION: f64 = 0.05;
/// Interval longer than this counts as gap (s).
pub const GAP_THRESHOLD_S: f64 = 1.5;

/// Run data as elapsed time (s) since run start and concentration (ppmv).
#[derive(Debug, Clone, Default)]
pub struct Series {
    pub times: Vec<f64>,
    pub concentrations: Vec<f64>,
}

impl Series {
    pub fn from_readings(run: &Run, readings: &Readings) -> Self {
        let times = readings.timestamps.iter().map(|timestamp| (timestamp - run.started_at) as f64 / 1000.0).collect();
        let concentrations = readings
            .counts
            .iter()
            .map(|count| concentration(*count, run.conversion_scale, run.conversion_exponent))
            .collect();
        Self { times, concentrations }
    }
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RunResult {
    pub sample_count: usize,
    pub gap_count: usize,
    pub missing_time_s: f64,
    pub flow_rate_ml_min: f64,
    pub baseline_ppm: f64,
    pub end_time_s: f64,
    pub co_ppm: f64,
    pub ghsv_per_h: f64,
    pub retention_time_s: f64,
    pub tb_s: f64,
    pub total_volume_l: f64,
    pub co2_volume_in_l: f64,
    pub stoichiometric_time_s: f64,
    pub blank_time_s: f64,
    pub adsorbed_volume_l: f64,
    pub adsorbed_mol: f64,
    pub capacity_mg_g: f64,
    pub capacity_mmol_g: f64,
    pub breakthrough_time_s: Option<f64>,
}

pub fn mean(values: impl Iterator<Item = f64>) -> f64 {
    let (sum, count) = values.fold((0.0, 0usize), |(sum, count), value| (sum + value, count + 1));
    if count == 0 { f64::NAN } else { sum / count as f64 }
}

/// Flow rate used in calculation: mean of measurements, or nominal value without measurements.
pub fn effective_flow_rate(run: &Run) -> f64 {
    let measurements = &run.parameters.flow_measurements;
    if measurements.is_empty() {
        run.parameters.flow_rate_ml_min
    } else {
        mean(measurements.iter().copied())
    }
}

/// Mean baseline (ppmv) over first window.
pub fn baseline(series: &Series, window_s: f64) -> f64 {
    mean(series.times.iter().zip(&series.concentrations).filter(|(time, _)| **time <= window_s).map(|(_, value)| *value))
}

/// Co (ppmv above baseline) as mean over last window.
pub fn inlet_concentration(series: &Series, window_s: f64, baseline_ppm: f64) -> f64 {
    let end = series.times.last().copied().unwrap_or(0.0);
    mean(
        series
            .times
            .iter()
            .zip(&series.concentrations)
            .filter(|(time, _)| **time >= end - window_s)
            .map(|(_, value)| *value),
    ) - baseline_ppm
}

/// Integral of (1 - C/Co) dt after delay (s). Each sample covers interval since previous sample.
pub fn stoichiometric_time(series: &Series, delay_s: f64, baseline_ppm: f64, co_ppm: f64) -> f64 {
    let mut total = 0.0;
    let mut previous = 0.0;
    for (time, value) in series.times.iter().zip(&series.concentrations) {
        if *time > delay_s {
            let interval = time - f64::max(previous, delay_s);
            total += interval * (1.0 - (value - baseline_ppm) / co_ppm);
        }
        previous = *time;
    }
    total
}

/// Stoichiometric time of a run with its own parameters; used for blank run.
pub fn run_stoichiometric_time(run: &Run, series: &Series) -> f64 {
    let baseline_ppm = baseline(series, run.parameters.baseline_window_s);
    let co_ppm = inlet_concentration(series, run.parameters.co_window_s, baseline_ppm);
    stoichiometric_time(series, run.parameters.delay_s, baseline_ppm, co_ppm)
}

pub fn calculate(run: &Run, series: &Series, blank_time_s: f64) -> RunResult {
    let parameters = &run.parameters;
    let flow = effective_flow_rate(run);
    let baseline_ppm = baseline(series, parameters.baseline_window_s);
    let co_ppm = inlet_concentration(series, parameters.co_window_s, baseline_ppm);
    let end_time_s = series.times.last().copied().unwrap_or(0.0);
    let tb_s = end_time_s - parameters.delay_s;
    let stoichiometric_time_s = stoichiometric_time(series, parameters.delay_s, baseline_ppm, co_ppm);
    let total_volume_l = flow * tb_s / 60.0 / 1000.0;
    let co2_volume_in_l = total_volume_l * co_ppm * 1e-6;
    let adsorbed_volume_l = flow / 60.0 / 1000.0 * co_ppm * 1e-6 * (stoichiometric_time_s - blank_time_s);
    let adsorbed_mol =
        adsorbed_volume_l * parameters.pressure_bar / GAS_CONSTANT / (parameters.temperature_c + KELVIN_OFFSET);
    let ghsv_per_h = flow * 60.0 / (parameters.mass_g / parameters.density_g_ml);

    let mut gap_count = 0;
    let mut missing_time_s = 0.0;
    for pair in series.times.windows(2) {
        let interval = pair[1] - pair[0];
        if interval > GAP_THRESHOLD_S {
            gap_count += 1;
            missing_time_s += interval - 1.0;
        }
    }

    let breakthrough_time_s = series
        .times
        .iter()
        .zip(&series.concentrations)
        .find(|(time, value)| **time > parameters.delay_s && (**value - baseline_ppm) / co_ppm >= BREAKTHROUGH_FRACTION)
        .map(|(time, _)| time - parameters.delay_s);

    RunResult {
        sample_count: series.times.len(),
        gap_count,
        missing_time_s,
        flow_rate_ml_min: flow,
        baseline_ppm,
        end_time_s,
        co_ppm,
        ghsv_per_h,
        retention_time_s: 3600.0 / ghsv_per_h,
        tb_s,
        total_volume_l,
        co2_volume_in_l,
        stoichiometric_time_s,
        blank_time_s,
        adsorbed_volume_l,
        adsorbed_mol,
        capacity_mg_g: 1000.0 * adsorbed_mol * CO2_MOLAR_MASS / parameters.mass_g,
        capacity_mmol_g: 1000.0 * adsorbed_mol / parameters.mass_g,
        breakthrough_time_s,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{RunParameters, RunStatus};

    fn run(parameters: RunParameters) -> Run {
        Run {
            id: 1,
            status: RunStatus::Finished,
            started_at: 0,
            finished_at: None,
            conversion_scale: 1785.9,
            conversion_exponent: 0.0111,
            export_path: None,
            parameters,
        }
    }

    fn parameters() -> RunParameters {
        RunParameters {
            flow_rate_ml_min: 60.0,
            mass_g: 1.0,
            density_g_ml: 1.0,
            pressure_bar: 1.0,
            temperature_c: 30.0,
            baseline_window_s: 10.0,
            co_window_s: 10.0,
            ..Default::default()
        }
    }

    /// Step curve: baseline 1000 for 100 s, then 31000 (Co = 30000 above baseline).
    fn step_series() -> Series {
        let times: Vec<f64> = (1..=200).map(f64::from).collect();
        let concentrations = times.iter().map(|time| if *time <= 100.0 { 1000.0 } else { 31000.0 }).collect();
        Series { times, concentrations }
    }

    #[test]
    fn step_curve_capacity() {
        let result = calculate(&run(parameters()), &step_series(), 0.0);
        assert_eq!(result.baseline_ppm, 1000.0);
        assert_eq!(result.co_ppm, 30000.0);
        assert_eq!(result.stoichiometric_time_s, 100.0);
        // 60 mL/min for 100 s at 3 % CO2 is 3 mL CO2
        assert!((result.adsorbed_volume_l - 0.003).abs() < 1e-12);
        let expected_mol = 0.003 / GAS_CONSTANT / (30.0 + KELVIN_OFFSET);
        assert!((result.capacity_mmol_g - 1000.0 * expected_mol).abs() < 1e-12);
        assert_eq!(result.breakthrough_time_s, Some(101.0));
        assert_eq!(result.gap_count, 0);
    }

    #[test]
    fn blank_and_delay_reduce_capacity() {
        let mut delayed = parameters();
        delayed.delay_s = 20.0;
        let result = calculate(&run(delayed), &step_series(), 30.0);
        assert_eq!(result.stoichiometric_time_s, 80.0);
        assert!((result.adsorbed_volume_l - 60.0 / 60.0 / 1000.0 * 0.03 * 50.0).abs() < 1e-12);
    }

    #[test]
    fn gap_uses_real_interval() {
        let mut series = step_series();
        // Remove samples 41 to 50 (10 s gap during adsorption)
        series.times.drain(40..50);
        series.concentrations.drain(40..50);
        let result = calculate(&run(parameters()), &series, 0.0);
        assert_eq!(result.gap_count, 1);
        assert_eq!(result.missing_time_s, 10.0);
        assert_eq!(result.stoichiometric_time_s, 100.0);
    }

    #[test]
    fn measured_flow_overrides_nominal() {
        let mut measured = parameters();
        measured.flow_measurements = vec![58.0, 59.0, 60.0, 61.0, 62.0];
        assert_eq!(effective_flow_rate(&run(measured)), 60.0);
    }
}
