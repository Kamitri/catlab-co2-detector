use serde::{Deserialize, Serialize};

use crate::protocol::{VENDOR_EXPONENT, VENDOR_SCALE};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub export_folder: String,
    pub file_name_pattern: String,
    pub baseline_window_s: f64,
    pub co_window_s: f64,
    pub equilibrium_band_percent: f64,
    pub equilibrium_duration_s: f64,
    pub conversion_scale: f64,
    pub conversion_exponent: f64,
    pub extra_ports: Vec<String>,
    pub retention_days: u32,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            export_folder: String::new(),
            file_name_pattern: "{date}_{time}_{sample}".into(),
            baseline_window_s: 60.0,
            co_window_s: 300.0,
            equilibrium_band_percent: 3.0,
            equilibrium_duration_s: 600.0,
            conversion_scale: VENDOR_SCALE,
            conversion_exponent: VENDOR_EXPONENT,
            extra_ports: Vec::new(),
            retention_days: 30,
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

/// Parameters entered by user; editable during and after run.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RunParameters {
    pub sample: String,
    pub operator: String,
    pub note: String,
    pub flow_rate_ml_min: f64,
    pub flow_measurements: Vec<f64>,
    pub mass_g: f64,
    pub density_g_ml: f64,
    pub pressure_bar: f64,
    pub temperature_c: f64,
    pub delay_s: f64,
    pub baseline_window_s: f64,
    pub co_window_s: f64,
    pub blank_run_id: Option<i64>,
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

/// Readings as parallel arrays: timestamp (ms since epoch) and count N.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Readings {
    pub timestamps: Vec<i64>,
    pub counts: Vec<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "state")]
pub enum Connection {
    Searching,
    Connected { port: String },
}
