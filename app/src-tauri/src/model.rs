use serde::{Deserialize, Serialize};

use crate::protocol::{VENDOR_EXPONENT, VENDOR_SCALE};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub export_folder: String,
    pub file_name_pattern: String,
    pub co_window_s: f64,
    pub equilibrium_band_percent: f64,
    pub conversion_scale: f64,
    pub conversion_exponent: f64,
    pub extra_ports: Vec<String>,
    pub retention_days: u32,
    /// Precision of balance (g); sets decimal places of sorbent mass.
    pub mass_precision_g: f64,
    /// Precision of soap film flowmeter (mL); sets decimal places of soap film volume.
    pub soap_volume_precision_ml: f64,
    /// "light", "dark" or "system".
    pub theme: String,
}

impl Settings {
    pub fn mass_decimals(&self) -> usize {
        decimals(self.mass_precision_g)
    }

    pub fn soap_volume_decimals(&self) -> usize {
        decimals(self.soap_volume_precision_ml)
    }
}

/// Decimal places of precision step, e.g. 0.0001 -> 4, 0.1 -> 1, 1 -> 0.
pub fn decimals(step: f64) -> usize {
    if step > 0.0 && step.is_finite() { (-step.log10()).round().clamp(0.0, 8.0) as usize } else { 0 }
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            export_folder: String::new(),
            file_name_pattern: "{date}_{time}_{sample}".into(),
            co_window_s: 300.0,
            equilibrium_band_percent: 3.0,
            conversion_scale: VENDOR_SCALE,
            conversion_exponent: VENDOR_EXPONENT,
            extra_ports: Vec::new(),
            retention_days: 30,
            mass_precision_g: 0.0001,
            soap_volume_precision_ml: 0.1,
            theme: "light".into(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RunStatus {
    Running,
    Finished,
    Aborted,
}

impl RunStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            RunStatus::Running => "running",
            RunStatus::Finished => "finished",
            RunStatus::Aborted => "aborted",
        }
    }

    pub fn parse(text: &str) -> Self {
        match text {
            "finished" => RunStatus::Finished,
            "aborted" => RunStatus::Aborted,
            _ => RunStatus::Running,
        }
    }
}

/// Parameters entered by user; editable before, during and after run.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RunParameters {
    pub sample: String,
    pub operator: String,
    pub note: String,
    /// Flow rate of runs without soap film times; 0 in new runs.
    pub flow_rate_ml_min: f64,
    /// Flow rates of earlier application versions (mL/min); empty in new runs.
    pub flow_measurements: Vec<f64>,
    /// Volume between marks of soap film flowmeter (mL).
    pub soap_volume_ml: f64,
    /// Soap film times over soap volume (s).
    pub soap_times_s: Vec<f64>,
    pub mass_g: f64,
    pub density_g_ml: f64,
    pub pressure_bar: f64,
    pub temperature_c: f64,
    pub delay_s: f64,
    pub co_window_s: f64,
    pub blank_run_id: Option<i64>,
}

impl Default for RunParameters {
    fn default() -> Self {
        Self {
            sample: String::new(),
            operator: String::new(),
            note: String::new(),
            flow_rate_ml_min: 0.0,
            flow_measurements: Vec::new(),
            soap_volume_ml: 5.0,
            soap_times_s: Vec::new(),
            mass_g: 0.0,
            density_g_ml: 0.0,
            pressure_bar: 0.0,
            temperature_c: 0.0,
            delay_s: 0.0,
            co_window_s: 0.0,
            blank_run_id: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Run {
    pub id: i64,
    pub status: RunStatus,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub conversion_scale: f64,
    pub conversion_exponent: f64,
    pub export_path: Option<String>,
    pub parameters: RunParameters,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Marker {
    pub id: i64,
    pub run_id: i64,
    pub timestamp: i64,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: i64,
    pub timestamp: i64,
    pub level: String,
    pub text: String,
}

/// Measurements as parallel arrays: timestamp (ms since epoch) and count N.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Measurements {
    pub timestamps: Vec<i64>,
    pub counts: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Connection {
    Searching,
    Connected { port: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimals_from_precision() {
        assert_eq!(decimals(0.0001), 4);
        assert_eq!(decimals(0.1), 1);
        assert_eq!(decimals(1.0), 0);
        assert_eq!(decimals(0.0), 0);
    }
}
