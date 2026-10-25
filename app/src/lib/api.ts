import { invoke } from "@tauri-apps/api/core"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"

export interface Settings {
  exportFolder: string
  fileNamePattern: string
  baselineWindowS: number
  coWindowS: number
  equilibriumBandPercent: number
  equilibriumDurationS: number
  conversionScale: number
  conversionExponent: number
  extraPorts: string[]
  retentionDays: number
}

export type RunStatus = "running" | "finished" | "aborted"

export interface RunParameters {
  sample: string
  operator: string
  note: string
  flowRateMlMin: number
  flowMeasurements: number[]
  massG: number
  densityGMl: number
  pressureBar: number
  temperatureC: number
  delayS: number
  baselineWindowS: number
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
}

export interface MeasurementEvent {
  timestamp: number
  count: number
}

export const api = {
  getSnapshot: () => invoke<Snapshot>("get_snapshot"),
  getMeasurements: (from: number, to: number) => invoke<Measurements>("get_measurements", { from, to }),
  saveSettings: (settings: Settings) => invoke<Settings>("save_settings", { settings }),
  startRun: (parameters: RunParameters) => invoke<Run>("start_run", { parameters }),
  updateRun: (id: number, parameters: RunParameters) => invoke<Run>("update_run", { id, parameters }),
  addMarker: (id: number, label: string, valveOpen: boolean) => invoke<Marker>("add_marker", { id, label, valveOpen }),
  getMarkers: (id: number) => invoke<Marker[]>("get_markers", { id }),
  getRunResult: (id: number) => invoke<RunResult>("get_run_result", { id }),
  exportRun: (id: number) => invoke<string>("export_run", { id }),
  finishRun: (id: number, parameters: RunParameters) => invoke<Run>("finish_run", { id, parameters }),
  abortRun: (id: number) => invoke<Run>("abort_run", { id }),
  /** Deletes chart measurements from `from` to now outside runs; returns end time. */
  clearChart: (from: number) => invoke<number>("clear_chart", { from }),
  listRuns: () => invoke<Run[]>("list_runs"),
  deleteRun: (id: number) => invoke<void>("delete_run", { id }),
  logMessage: (level: MessageLevel, text: string) => invoke<void>("log_message", { level, text }),
  defaultFolder: () => invoke<string>("default_folder"),
  dataFolder: () => invoke<string>("data_folder"),
  exitApp: () => invoke<void>("exit_app"),
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
}
