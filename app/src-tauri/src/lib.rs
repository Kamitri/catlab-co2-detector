pub mod acquisition;
pub mod calculation;
pub mod db;
pub mod export;
pub mod model;
pub mod protocol;

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};

use acquisition::{Sink, now_ms};
use calculation::{RunResult, Series, calculate, run_stoichiometric_time};
use db::Database;
use model::{Connection, Marker, Measurements, Message, Run, RunParameters, RunStatus, Settings};

const VALVE_OPEN_LABEL: &str = "Valve open";
const DAY_MS: i64 = 86_400_000;

/// Without tray, hidden window could not be shown again; close button then exits.
struct TrayAvailable(bool);

pub struct AppState {
    database: Arc<Mutex<Database>>,
    connection: Arc<Mutex<Connection>>,
    keep_awake: Mutex<Option<keepawake::KeepAwake>>,
}

type CommandResult<T> = Result<T, String>;

fn error_text(error: impl std::fmt::Display) -> String {
    error.to_string()
}

/// Locks mutex and keeps data usable after panic in another thread, instead of failing every later call.
fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

/// Receives acquisition events: stores measurements and messages, forwards them to UI.
struct TauriSink {
    app: AppHandle,
    database: Arc<Mutex<Database>>,
    connection: Arc<Mutex<Connection>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MeasurementEvent {
    timestamp: i64,
    count: u32,
}

impl Sink for TauriSink {
    fn measurement(&self, timestamp: i64, count: u32) {
        // Lock is released at end of statement, before message() locks database again
        let result = lock(&self.database).insert_measurement(timestamp, count);
        if let Err(error) = result {
            self.message("error", &format!("Database write failed: {error}"));
        }
        let _ = self.app.emit("measurement", MeasurementEvent { timestamp, count });
    }

    fn connection(&self, connection: Connection) {
        *lock(&self.connection) = connection.clone();
        let _ = self.app.emit("connection", connection);
    }

    fn message(&self, level: &str, text: &str) {
        let message = lock(&self.database).insert_message(now_ms(), level, text);
        if let Ok(message) = message {
            let _ = self.app.emit("message", message);
        }
    }

    fn extra_ports(&self) -> Vec<String> {
        let mut ports = lock(&self.database).settings().unwrap_or_default().extra_ports;
        // Development only: system does not list virtual ports, for example CO2_EXTRA_PORTS=/tmp/co2-app
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
    let mut guard = lock(&state.keep_awake);
    if active && guard.is_none() {
        *guard = keepawake::Builder::default()
            .idle(true)
            .sleep(true)
            .reason("Run in progress")
            .app_name("CATlab CO2 Monitor")
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
        .join("CATlab CO2 Monitor")
}

fn has_active_run(app: &AppHandle) -> bool {
    app.try_state::<AppState>()
        .map(|state| lock(&state.database).active_run().ok().flatten().is_some())
        .unwrap_or(false)
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Exits directly without run in progress; otherwise UI requires confirmation first.
fn request_exit(app: &AppHandle) {
    if has_active_run(app) {
        show_main_window(app);
        let _ = app.emit("exit-requested", ());
    } else {
        app.exit(0);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    connection: Connection,
    active_run: Option<Run>,
    messages: Vec<Message>,
    settings: Settings,
    sample: Option<RunParameters>,
}

#[tauri::command]
fn get_snapshot(state: State<AppState>) -> CommandResult<Snapshot> {
    let database = lock(&state.database);
    Ok(Snapshot {
        connection: lock(&state.connection).clone(),
        active_run: database.active_run().map_err(error_text)?,
        messages: database.recent_messages(300).map_err(error_text)?,
        settings: database.settings().map_err(error_text)?,
        sample: database.sample().map_err(error_text)?,
    })
}

#[tauri::command]
fn get_measurements(state: State<AppState>, from: i64, to: i64) -> CommandResult<Measurements> {
    lock(&state.database).measurements(from, to).map_err(error_text)
}

#[tauri::command]
fn save_settings(app: AppHandle, state: State<AppState>, settings: Settings) -> CommandResult<Settings> {
    let database = lock(&state.database);
    database.save_settings(&settings).map_err(error_text)?;
    log(&app, &database, "info", "Settings saved");
    Ok(settings)
}

#[tauri::command]
fn save_sample(state: State<AppState>, parameters: RunParameters) -> CommandResult<RunParameters> {
    lock(&state.database).save_sample(&parameters).map_err(error_text)?;
    Ok(parameters)
}

/// Starts run at once with sample configured before Start.
#[tauri::command]
fn start_run(app: AppHandle, state: State<AppState>) -> CommandResult<Run> {
    let started_at = now_ms();
    let run = {
        let database = lock(&state.database);
        if database.active_run().map_err(error_text)?.is_some() {
            return Err("Run already in progress".into());
        }
        let parameters = database.sample().map_err(error_text)?.ok_or("Sample not configured")?;
        let settings = database.settings().map_err(error_text)?;
        let id = database
            .insert_run(started_at, settings.conversion_scale, settings.conversion_exponent, &parameters)
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
    let database = lock(&state.database);
    database.update_parameters(id, &parameters).map_err(error_text)?;
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    let _ = app.emit("run", &run);
    Ok(run)
}

fn running_run(database: &Database, id: i64) -> CommandResult<Run> {
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    if run.status != RunStatus::Running {
        return Err("Run not in progress".into());
    }
    Ok(run)
}

#[tauri::command]
fn add_marker(
    app: AppHandle,
    state: State<AppState>,
    id: i64,
    label: String,
    valve_open: bool,
) -> CommandResult<Marker> {
    let database = lock(&state.database);
    let mut run = running_run(&database, id)?;
    let timestamp = now_ms();
    if !valve_open {
        let marker = database.insert_marker(id, timestamp, &label).map_err(error_text)?;
        log(&app, &database, "info", &format!("Marker added: {label}"));
        return Ok(marker);
    }
    // Valve open defines delay time; later click replaces earlier one
    database.delete_markers(id, VALVE_OPEN_LABEL).map_err(error_text)?;
    let marker = database.insert_marker(id, timestamp, VALVE_OPEN_LABEL).map_err(error_text)?;
    run.parameters.delay_s = ((timestamp - run.started_at) as f64 / 1000.0).round();
    database.update_parameters(id, &run.parameters).map_err(error_text)?;
    log(&app, &database, "info", VALVE_OPEN_LABEL);
    let _ = app.emit("run", &run);
    Ok(marker)
}

#[tauri::command]
fn get_markers(state: State<AppState>, id: i64) -> CommandResult<Vec<Marker>> {
    lock(&state.database).markers(id).map_err(error_text)
}

fn run_measurements(database: &Database, run: &Run) -> Result<Measurements, rusqlite::Error> {
    database.measurements(run.started_at, run.finished_at.unwrap_or_else(now_ms))
}

/// Calculates result of run; returns result, label of blank run if used, and measurements.
fn run_result(database: &Database, run: &Run) -> Result<(RunResult, Option<String>, Measurements), String> {
    let measurements = run_measurements(database, run).map_err(error_text)?;
    let series = Series::from_measurements(run, &measurements);
    let mut blank_time_s = 0.0;
    let mut blank_label = None;
    if let Some(blank) =
        run.parameters.blank_run_id.map(|id| database.run(id)).transpose().map_err(error_text)?.flatten()
    {
        let blank_measurements = run_measurements(database, &blank).map_err(error_text)?;
        blank_time_s = run_stoichiometric_time(&blank, &Series::from_measurements(&blank, &blank_measurements));
        blank_label = Some(format!("Blank run: {} (#{})", blank.parameters.sample, blank.id));
    }
    Ok((calculate(run, &series, blank_time_s), blank_label, measurements))
}

#[tauri::command]
fn get_run_result(state: State<AppState>, id: i64) -> CommandResult<RunResult> {
    let database = lock(&state.database);
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    Ok(run_result(&database, &run)?.0)
}

/// Data for one export, collected under database lock.
struct ExportJob {
    path: PathBuf,
    run: Run,
    measurements: Measurements,
    result: RunResult,
    blank_label: Option<String>,
}

/// Export folder of Settings, or default folder when not set; folder is created when missing.
fn export_folder_path(app: &AppHandle, database: &Database) -> CommandResult<PathBuf> {
    let settings = database.settings().map_err(error_text)?;
    let folder = if settings.export_folder.is_empty() {
        default_export_folder(app)
    } else {
        PathBuf::from(&settings.export_folder)
    };
    std::fs::create_dir_all(&folder).map_err(error_text)?;
    Ok(folder)
}

#[tauri::command]
fn export_folder(app: AppHandle, state: State<AppState>) -> CommandResult<String> {
    Ok(export_folder_path(&app, &lock(&state.database))?.display().to_string())
}

fn prepare_export(app: &AppHandle, database: &Database, run: Run) -> CommandResult<ExportJob> {
    let settings = database.settings().map_err(error_text)?;
    let folder = export_folder_path(app, database)?;
    let path = export::unique_path(&folder, &export::file_name(&settings.file_name_pattern, &run));
    let (result, blank_label, measurements) = run_result(database, &run)?;
    Ok(ExportJob { path, run, measurements, result, blank_label })
}

/// Writes workbook without database lock, keeping acquisition able to store measurements during export.
fn write_export(app: &AppHandle, state: &AppState, job: ExportJob) -> CommandResult<String> {
    let input = export::ExportInput {
        run: &job.run,
        measurements: &job.measurements,
        result: &job.result,
        blank_label: job.blank_label.clone(),
        cached_results: true,
    };
    export::write_workbook(&job.path, &[input]).map_err(error_text)?;
    let path_text = job.path.display().to_string();
    let database = lock(&state.database);
    database.set_export_path(job.run.id, &path_text).map_err(error_text)?;
    let file_name = job.path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    log(app, &database, "info", &format!("Exported {file_name}"));
    Ok(path_text)
}

fn log_export_error(app: &AppHandle, state: &AppState, error: &str) {
    log(app, &lock(&state.database), "error", &format!("Export failed: {error}"));
}

#[tauri::command]
fn export_run(app: AppHandle, state: State<AppState>, id: i64) -> CommandResult<String> {
    let job = {
        let database = lock(&state.database);
        let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
        prepare_export(&app, &database, run)
    };
    job.and_then(|job| write_export(&app, &state, job)).inspect_err(|error| log_export_error(&app, &state, error))
}

/// Exports runs to one workbook at path chosen by user, one sheet per run.
#[tauri::command]
fn export_runs(app: AppHandle, state: State<AppState>, ids: Vec<i64>, path: String) -> CommandResult<String> {
    let jobs = {
        let database = lock(&state.database);
        let mut jobs = Vec::new();
        for id in ids {
            let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
            let (result, blank_label, measurements) = run_result(&database, &run)?;
            jobs.push(ExportJob { path: PathBuf::from(&path), run, measurements, result, blank_label });
        }
        jobs
    };
    let inputs: Vec<export::ExportInput> = jobs
        .iter()
        .map(|job| export::ExportInput {
            run: &job.run,
            measurements: &job.measurements,
            result: &job.result,
            blank_label: job.blank_label.clone(),
            cached_results: true,
        })
        .collect();
    let path = PathBuf::from(&path);
    export::write_workbook(&path, &inputs)
        .map_err(error_text)
        .inspect_err(|error| log_export_error(&app, &state, error))?;
    let file_name = path.file_name().map(|name| name.to_string_lossy().to_string()).unwrap_or_default();
    log(&app, &lock(&state.database), "info", &format!("Exported {file_name}"));
    Ok(path.display().to_string())
}

fn end_run(
    app: &AppHandle,
    state: &AppState,
    id: i64,
    status: RunStatus,
    parameters: Option<RunParameters>,
) -> CommandResult<Run> {
    let job = {
        let database = lock(&state.database);
        running_run(&database, id)?;
        if let Some(parameters) = parameters {
            database.update_parameters(id, &parameters).map_err(error_text)?;
        }
        database.set_status(id, status, Some(now_ms())).map_err(error_text)?;
        let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
        let verb = if status == RunStatus::Finished { "finished" } else { "aborted" };
        log(app, &database, "info", &format!("Run {verb}: {}", run.parameters.sample));
        let retention_days = database.settings().map(|settings| settings.retention_days).unwrap_or(30);
        let _ = database.prune_measurements(now_ms() - i64::from(retention_days) * DAY_MS);
        prepare_export(app, &database, run)
    };
    set_keep_awake(state, false);
    if let Err(error) = job.and_then(|job| write_export(app, state, job)) {
        log_export_error(app, state, &error);
    }
    let run = lock(&state.database).run(id).map_err(error_text)?.ok_or("Run not found")?;
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

/// Deletes chart measurements from `from` to now, except measurements of runs; returns end time.
#[tauri::command]
fn clear_chart(app: AppHandle, state: State<AppState>, from: i64) -> CommandResult<i64> {
    let database = lock(&state.database);
    if database.active_run().map_err(error_text)?.is_some() {
        return Err("Run in progress".into());
    }
    let to = now_ms();
    database.delete_measurements_outside_runs(from, to).map_err(error_text)?;
    log(&app, &database, "info", "Chart cleared");
    Ok(to)
}

#[tauri::command]
fn list_runs(state: State<AppState>) -> CommandResult<Vec<Run>> {
    lock(&state.database).runs().map_err(error_text)
}

#[tauri::command]
fn delete_run(app: AppHandle, state: State<AppState>, id: i64) -> CommandResult<()> {
    let database = lock(&state.database);
    let run = database.run(id).map_err(error_text)?.ok_or("Run not found")?;
    if run.status == RunStatus::Running {
        return Err("Run in progress".into());
    }
    let users = database.runs_using_blank(id).map_err(error_text)?;
    if !users.is_empty() {
        return Err(format!("Run is blank run of {}", users.join(", ")));
    }
    database.delete_run(id).map_err(error_text)?;
    log(&app, &database, "info", &format!("Run deleted: {}", run.parameters.sample));
    Ok(())
}

#[tauri::command]
fn log_message(app: AppHandle, state: State<AppState>, level: String, text: String) -> CommandResult<()> {
    log(&app, &lock(&state.database), &level, &text);
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

#[tauri::command]
fn exit_app(app: AppHandle) {
    app.exit(0);
}

fn create_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &exit])?;
    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("CATlab CO₂ Monitor")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main_window(app),
            "exit" => request_exit(app),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
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
            database.prune_measurements(now_ms() - i64::from(settings.retention_days) * DAY_MS)?;
            let active_run = database.active_run()?;
            database.insert_message(now_ms(), "info", "Application started")?;
            if let Some(run) = &active_run {
                database.insert_message(now_ms(), "warning", &format!("Run recovered: {}", run.parameters.sample))?;
            }

            let database = Arc::new(Mutex::new(database));
            let connection = Arc::new(Mutex::new(Connection::Searching));
            let state =
                AppState { database: database.clone(), connection: connection.clone(), keep_awake: Mutex::new(None) };
            if active_run.is_some() {
                set_keep_awake(&state, true);
            }
            let tray_available = create_tray(app).is_ok();
            if !tray_available {
                database.lock().unwrap_or_else(PoisonError::into_inner).insert_message(
                    now_ms(),
                    "warning",
                    "System tray not available",
                )?;
            }
            app.manage(TrayAvailable(tray_available));
            app.manage(state);

            let sink = Arc::new(TauriSink { app: app.handle().clone(), database, connection });
            acquisition::spawn(sink, acquisition::Timing::from_environment(), Arc::new(AtomicBool::new(false)));
            Ok(())
        })
        .on_window_event(|window, event| {
            // During run, closing window hides it to tray; acquisition and recording continue
            if let WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                let tray_available = app.try_state::<TrayAvailable>().is_some_and(|tray| tray.0);
                if tray_available && has_active_run(app) {
                    api.prevent_close();
                    let _ = window.hide();
                    if let Some(state) = app.try_state::<AppState>() {
                        log(app, &lock(&state.database), "info", "Window hidden to tray");
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_measurements,
            save_settings,
            save_sample,
            start_run,
            update_run,
            add_marker,
            get_markers,
            get_run_result,
            export_run,
            export_runs,
            export_folder,
            finish_run,
            abort_run,
            clear_chart,
            list_runs,
            delete_run,
            log_message,
            data_folder,
            default_folder,
            exit_app,
        ])
        .run(tauri::generate_context!())
        .expect("Error while running application");
}
