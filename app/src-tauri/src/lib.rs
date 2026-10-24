pub mod acquisition;
pub mod calculation;
pub mod db;
pub mod export;
pub mod model;
pub mod protocol;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use acquisition::{Sink, now_ms};
use calculation::{RunResult, Series, calculate, run_stoichiometric_time};
use db::Database;
use model::{Connection, Marker, Message, Readings, Run, RunParameters, RunStatus, Settings};

pub struct AppState {
    database: Arc<Mutex<Database>>,
    connection: Arc<Mutex<Connection>>,
    keep_awake: Mutex<Option<keepawake::KeepAwake>>,
}

type CommandResult<T> = Result<T, String>;

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Receives acquisition events: stores readings and messages, forwards them to UI.
struct TauriSink {
    app: AppHandle,
    database: Arc<Mutex<Database>>,
    connection: Arc<Mutex<Connection>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ReadingEvent {
    timestamp: i64,
    count: u32,
}

impl Sink for TauriSink {
    fn reading(&self, timestamp: i64, count: u32) {
        if let Err(error) = self.database.lock().unwrap().insert_reading(timestamp, count) {
            self.message("error", &format!("Database write failed: {error}"));
        }
        let _ = self.app.emit("reading", ReadingEvent { timestamp, count });
    }

    fn connection(&self, connection: Connection) {
        *self.connection.lock().unwrap() = connection.clone();
        let _ = self.app.emit("connection", connection);
    }

    fn message(&self, level: &str, text: &str) {
        if let Ok(message) = self.database.lock().unwrap().insert_message(now_ms(), level, text) {
            let _ = self.app.emit("message", message);
        }
    }

    fn extra_ports(&self) -> Vec<String> {
        let mut ports =
            self.database.lock().map(|database| database.settings().unwrap_or_default().extra_ports).unwrap_or_default();
        // Development: virtual ports are not listed by system, e.g. CO2_EXTRA_PORTS=/tmp/co2-app
        if let Ok(value) = std::env::var("CO2_EXTRA_PORTS") {
            ports.extend(value.split(',').map(|port| port.trim().to_string()).filter(|port| !port.is_empty()));
        }
        ports
    }
}

fn log(app: &AppHandle, database: &Database, level: &str, text: &str) {
    if let Ok(message) = database.insert_message(now_ms(), level, text) {
        let _ = app.emit("message", message);
    }
}

fn set_keep_awake(state: &AppState, active: bool) {
    let mut guard = state.keep_awake.lock().unwrap();
    if active && guard.is_none() {
        *guard = keepawake::Builder::default()
            .idle(true)
            .sleep(true)
            .reason("Run in progress")
            .app_name("CO2 Monitor")
            .app_reverse_domain("com.catlab.co2monitor")
            .create()
            .ok();
    } else if !active {
        *guard = None;
    }
}

fn default_export_folder(app: &AppHandle) -> PathBuf {
    app.path()
        .document_dir()
        .or_else(|_| app.path().home_dir())
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("CO2 Monitor")
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    connection: Connection,
    active_run: Option<Run>,
    messages: Vec<Message>,
    settings: Settings,
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> CommandResult<Snapshot> {
    let database = state.database.lock().unwrap();
    Ok(Snapshot {
        connection: state.connection.lock().unwrap().clone(),
        active_run: database.active_run().map_err(error_text)?,
        messages: database.recent_messages(300).map_err(error_text)?,
        settings: database.settings().map_err(error_text)?,
    })
}

#[tauri::command]
fn get_readings(state: State<AppState>, from: i64, to: i64) -> CommandResult<Readings> {
    state.database.lock().unwrap().readings(from, to).map_err(error_text)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> CommandResult<Settings> {
    let database = state.database.lock().unwrap();
    database.save_settings(&settings).map_err(error_text)?;
    log(&app, &database, "info", "Settings saved");
    Ok(settings)
}

#[tauri::command]
fn start_run(app: AppHandle, state: State<AppState>, parameters: RunParameters) -> CommandResult<Run> {
    let run = {
        let database = state.database.lock().unwrap();
        if database.active_run().map_err(error_text)?.is_some() {
            return Err("Run already in progress".into());
        }
        let settings = database.settings().map_err(error_text)?;
        let id = database
            .insert_run(now_ms(), settings.conversion_scale, settings.conversion_exponent, &parameters)
            .map_err(error_text)?;
        log(&app, &database, "info", &format!("Run started: {}", parameters.sample));
        database.run(id).map_err(error_text)?.ok_or("Run not found")?
    };
    set_keep_awake(&state, true);
    let _ = app.emit("run", &run);
    Ok(run)
}

#[tauri::command]
fn update_run(app: AppHandle, state: State<AppState>, id: i64, parameters: RunParameters) -> CommandResult<Run> {
    let database = state.database.lock().unwrap();
    database.update_parameters(id, &parameters).map_err(error_text)?;
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    let _ = app.emit("run", &run);
    Ok(run)
}

#[tauri::command]
fn add_marker(app: AppHandle, state: State<AppState>, id: i64, label: String, valve_open: bool) -> CommandResult<Marker> {
    let database = state.database.lock().unwrap();
    let timestamp = now_ms();
    let marker = database.insert_marker(id, timestamp, &label).map_err(error_text)?;
    if valve_open {
        let mut run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
        run.parameters.delay_s = ((timestamp - run.started_at) as f64 / 1000.0).round();
        database.update_parameters(id, &run.parameters).map_err(error_text)?;
        let _ = app.emit("run", &run);
        log(&app, &database, "info", &label);
    } else {
        log(&app, &database, "info", &format!("Marker added: {label}"));
    }
    Ok(marker)
}

#[tauri::command]
fn get_markers(state: State<AppState>, id: i64) -> CommandResult<Vec<Marker>> {
    state.database.lock().unwrap().markers(id).map_err(error_text)
}

fn run_readings(database: &Database, run: &Run) -> Result<Readings, rusqlite::Error> {
    database.readings(run.started_at, run.finished_at.unwrap_or_else(now_ms))
}

/// Calculates result of run; returns result and label of blank run if used.
fn run_result(database: &Database, run: &Run) -> Result<(RunResult, Option<String>, Readings), String> {
    let readings = run_readings(database, run).map_err(error_text)?;
    let series = Series::from_readings(run, &readings);
    let mut blank_time_s = 0.0;
    let mut blank_label = None;
    if let Some(blank_id) = run.parameters.blank_run_id {
        if let Some(blank) = database.run(blank_id).map_err(error_text)? {
            let blank_readings = run_readings(database, &blank).map_err(error_text)?;
            blank_time_s = run_stoichiometric_time(&blank, &Series::from_readings(&blank, &blank_readings));
            blank_label = Some(format!("Blank run: {} (#{})", blank.parameters.sample, blank.id));
        }
    }
    Ok((calculate(run, &series, blank_time_s), blank_label, readings))
}

#[tauri::command]
fn get_run_result(state: State<AppState>, id: i64) -> CommandResult<RunResult> {
    let database = state.database.lock().unwrap();
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    Ok(run_result(&database, &run)?.0)
}

fn export(app: &AppHandle, database: &Database, run: &Run) -> CommandResult<String> {
    let settings = database.settings().map_err(error_text)?;
    let folder =
        if settings.export_folder.is_empty() { default_export_folder(app) } else { PathBuf::from(&settings.export_folder) };
    std::fs::create_dir_all(&folder).map_err(error_text)?;
    let path = export::unique_path(&folder, &export::file_name(&settings.file_name_pattern, run));
    let (result, blank_label, readings) = run_result(database, run)?;
    export::write_workbook(
        &path,
        &export::ExportInput { run, readings: &readings, result: &result, blank_label, cached_results: true },
    )
    .map_err(error_text)?;
    let path_text = path.display().to_string();
    database.set_export_path(run.id, &path_text).map_err(error_text)?;
    let file_name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    log(app, database, "info", &format!("Exported {file_name}"));
    Ok(path_text)
}

#[tauri::command]
fn export_run(app: AppHandle, state: State<AppState>, id: i64) -> CommandResult<String> {
    let database = state.database.lock().unwrap();
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    export(&app, &database, &run).inspect_err(|error| log(&app, &database, "error", &format!("Export failed: {error}")))
}

fn end_run(app: &AppHandle, state: &AppState, id: i64, status: RunStatus, parameters: Option<RunParameters>) -> CommandResult<Run> {
    let run = {
        let database = state.database.lock().unwrap();
        if let Some(parameters) = parameters {
            database.update_parameters(id, &parameters).map_err(error_text)?;
        }
        database.set_status(id, status, Some(now_ms())).map_err(error_text)?;
        let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
        let verb = if status == RunStatus::Finished { "finished" } else { "aborted" };
        log(app, &database, "info", &format!("Run {verb}: {}", run.parameters.sample));
        if let Err(error) = export(app, &database, &run) {
            log(app, &database, "error", &format!("Export failed: {error}"));
        }
        database.run(id).map_err(error_text)?.ok_or("Run not found")?
    };
    set_keep_awake(state, false);
    let _ = app.emit("run", &run);
    Ok(run)
}

#[tauri::command]
fn finish_run(app: AppHandle, state: State<AppState>, id: i64, parameters: RunParameters) -> CommandResult<Run> {
    end_run(&app, &state, id, RunStatus::Finished, Some(parameters))
}

#[tauri::command]
fn abort_run(app: AppHandle, state: State<AppState>, id: i64) -> CommandResult<Run> {
    end_run(&app, &state, id, RunStatus::Aborted, None)
}

#[tauri::command]
fn list_runs(state: State<AppState>) -> CommandResult<Vec<Run>> {
    state.database.lock().unwrap().runs().map_err(error_text)
}

#[tauri::command]
fn delete_run(app: AppHandle, state: State<AppState>, id: i64) -> CommandResult<()> {
    let database = state.database.lock().unwrap();
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    if run.status == RunStatus::Running {
        return Err("Run in progress".into());
    }
    database.delete_run(id).map_err(error_text)?;
    log(&app, &database, "info", &format!("Run deleted: {}", run.parameters.sample));
    Ok(())
}

#[tauri::command]
fn log_message(app: AppHandle, state: State<AppState>, level: String, text: String) -> CommandResult<()> {
    log(&app, &state.database.lock().unwrap(), &level, &text);
    Ok(())
}

#[tauri::command]
fn data_folder(app: AppHandle) -> String {
    app.path().app_data_dir().map(|path| path.display().to_string()).unwrap_or_default()
}

#[tauri::command]
fn default_folder(app: AppHandle) -> String {
    default_export_folder(&app).display().to_string()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_folder = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_folder)?;
            let database = Database::open(&data_folder.join("co2-monitor.db"))?;
            let settings = database.settings()?;
            let cutoff = now_ms() - i64::from(settings.retention_days) * 86_400_000;
            database.prune_readings(cutoff)?;
            let active_run = database.active_run()?;
            database.insert_message(now_ms(), "info", "Application started")?;
            if let Some(run) = &active_run {
                database.insert_message(now_ms(), "warning", &format!("Run recovered: {}", run.parameters.sample))?;
            }

            let database = Arc::new(Mutex::new(database));
            let connection = Arc::new(Mutex::new(Connection::Searching));
            let state = AppState { database: database.clone(), connection: connection.clone(), keep_awake: Mutex::new(None) };
            if active_run.is_some() {
                set_keep_awake(&state, true);
            }
            app.manage(state);

            let sink = Arc::new(TauriSink { app: app.handle().clone(), database, connection });
            acquisition::spawn(sink, Arc::new(AtomicBool::new(false)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_readings,
            save_settings,
            start_run,
            update_run,
            add_marker,
            get_markers,
            get_run_result,
            export_run,
            finish_run,
            abort_run,
            list_runs,
            delete_run,
            log_message,
            data_folder,
            default_folder,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running application");
}
