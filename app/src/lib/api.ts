import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export interface Settings {
  exportFolder: string
  fileNamePattern: string
  coWindowS: number
  equilibriumBandPercent: number
  conversionScale: number
  conversionExponent: number
  extraPorts: string[]
  retentionDays: number
  massPrecisionG: number
  soapVolumePrecisionMl: number
  theme: Theme
}

export type Theme = "light" | "dark" | "system"

export type RunStatus = "running" | "finished" | "aborted"

export interface RunParameters {
  sample: string
  operator: string
  note: string
  flowRateMlMin: number
  flowMeasurements: number[]
  soapVolumeMl: number
  soapTimesS: number[]
  massG: number
  densityGMl: number
  pressureBar: number
  temperatureC: number
  delayS: number
  coWindowS: number
  blankRunId: number | null
}

export interface Run {
  id: number
  status: RunStatus
  startedAt: number
  finishedAt: number | null
  conversionScale: number
  conversionExponent: number
  exportPath: string | null
  parameters: RunParameters
  /** Data was edited; edited data replaces measurements in calculation and export. */
  edited: boolean
}

/** Data of run: elapsed time (s) and CO₂ (ppm). */
export interface RunData {
  times: number[]
  values: number[]
  edited: boolean
}

export interface Marker {
  id: number
  runId: number
  timestamp: number
  label: string
}

export type MessageLevel = "info" | "warning" | "error"

export interface Message {
  id: number
  timestamp: number
  level: MessageLevel
  text: string
}

export interface Measurements {
  timestamps: number[]
  counts: number[]
}

export type Connection = { state: "searching" } | { state: "connected"; port: string }

export interface RunResult {
  sampleCount: number
  gapCount: number
  missingTimeS: number
  flowRateMlMin: number
  baselinePpm: number | null
  endTimeS: number
  coPpm: number | null
  ghsvPerH: number | null
  retentionTimeS: number | null
  tbS: number
  totalVolumeL: number | null
  co2VolumeInL: number | null
  stoichiometricTimeS: number | null
  blankTimeS: number
  adsorbedVolumeL: number | null
  adsorbedMol: number | null
  capacityMgG: number | null
  capacityMmolG: number | null
  breakthroughTimeS: number | null
}

export interface Snapshot {
  connection: Connection
  activeRun: Run | null
  messages: Message[]
  settings: Settings
  sample: RunParameters | null
}

export interface MeasurementEvent {
  timestamp: number
  count: number
}

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  getMeasurements: (from: number, to: number) => invoke<Measurements>("get_measurements", { from, to }),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  saveSample: (parameters: RunParameters) => invoke<RunParameters>("save_sample", { parameters }),
  /** Starts run at once with saved sample. */
  startRun: () => invoke<Run>("start_run"),
  updateRun: (id: number, parameters: RunParameters) => invoke<Run>("update_run", { id, parameters }),
  addMarker: (id: number, label: string) => invoke<Marker>("add_marker", { id, label }),
  getMarkers: (id: number) => invoke<Marker[]>("get_markers", { id }),
  getRunResult: (id: number) => invoke<RunResult>("get_run_result", { id }),
  getRunData: (id: number) => invoke<RunData>("get_run_data", { id }),
  /** Saves edited data; measurements stay unchanged. */
  saveRunData: (id: number, times: number[], values: number[]) => invoke<void>("save_run_data", { id, times, values }),
  /** Removes edited data; run uses measurements again. */
  restoreRunData: (id: number) => invoke<void>("restore_run_data", { id }),
  exportRun: (id: number) => invoke<string>("export_run", { id }),
  /** Exports runs to one workbook, one sheet per run. */
  exportRuns: (ids: number[], path: string) => invoke<string>("export_runs", { ids, path }),
  exportFolder: () => invoke<string>("export_folder"),
  openExportFolder: () => invoke<void>("open_export_folder"),
  finishRun: (id: number, parameters: RunParameters) => invoke<Run>("finish_run", { id, parameters }),
  abortRun: (id: number) => invoke<Run>("abort_run", { id }),
  /** Deletes chart measurements from `from` to now outside runs; returns end time. */
  clearChart: (from: number) => invoke<number>("clear_chart", { from }),
  listRuns: () => invoke<Run[]>("list_runs"),
  /** Sets order of runs in History; ids from top to bottom. */
  reorderRuns: (ids: number[]) => invoke<void>("reorder_runs", { ids }),
  deleteRun: (id: number) => invoke<void>("delete_run", { id }),
  logMessage: (level: MessageLevel, text: string) => invoke<void>("log_message", { level, text }),
  deleteMessage: (id: number) => invoke<void>("delete_message", { id }),
  clearMessages: () => invoke<void>("clear_messages"),
  defaultFolder: () => invoke<string>("default_folder"),
  dataFolder: () => invoke<string>("data_folder"),
  exitApp: () => invoke<void>("exit_app"),
  /** Hides window to tray; recording continues. */
  hideWindow: () => invoke<void>("hide_window"),
}

export const events = {
  onMeasurement: (handler: (event: MeasurementEvent) => void): Promise<UnlistenFn> =>
    listen<MeasurementEvent>("measurement", (event) => handler(event.payload)),
  onConnection: (handler: (connection: Connection) => void): Promise<UnlistenFn> =>
    listen<Connection>("connection", (event) => handler(event.payload)),
  onMessage: (handler: (message: Message) => void): Promise<UnlistenFn> =>
    listen<Message>("message", (event) => handler(event.payload)),
  onRun: (handler: (run: Run) => void): Promise<UnlistenFn> => listen<Run>("run", (event) => handler(event.payload)),
  onExitRequested: (handler: () => void): Promise<UnlistenFn> => listen("exit-requested", () => handler()),
  onCloseRequested: (handler: () => void): Promise<UnlistenFn> => listen("close-requested", () => handler()),
}
