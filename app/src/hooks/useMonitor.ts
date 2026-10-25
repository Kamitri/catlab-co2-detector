import { useCallback, useEffect, useRef, useState } from "react"

import {
  api,
  events,
  type Connection,
  type Marker,
  type Message,
  type MeasurementEvent,
  type Measurements,
  type Run,
  type RunResult,
  type Settings,
} from "@/lib/api"
import { detectEquilibrium, runSeries } from "@/lib/data"
import { formatDuration } from "@/lib/format"

/** Time span shown outside run (ms). */
export const MONITOR_SPAN_MS = 30 * 60 * 1000
const MESSAGE_LIMIT = 500

export interface MonitorState {
  ready: boolean
  connection: Connection
  settings: Settings | null
  activeRun: Run | null
  recoveredRun: Run | null
  messages: Message[]
  latest: MeasurementEvent | null
  measurements: Measurements
  measurementsVersion: number
  markers: Marker[]
  equilibriumAt: number | null
  lastRun: Run | null
  lastResult: RunResult | null
}

export function useMonitor() {
  const [connection, setConnection] = useState<Connection>({ state: "searching" })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [activeRun, setActiveRun] = useState<Run | null>(null)
  const [recoveredRun, setRecoveredRun] = useState<Run | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [latest, setLatest] = useState<MeasurementEvent | null>(null)
  const [measurementsVersion, setMeasurementsVersion] = useState(0)
  const [markers, setMarkers] = useState<Marker[]>([])
  const [equilibriumAt, setEquilibriumAt] = useState<number | null>(null)
  const [lastRun, setLastRun] = useState<Run | null>(null)
  const [lastResult, setLastResult] = useState<RunResult | null>(null)
  const [ready, setReady] = useState(false)

  const measurements = useRef<Measurements>({ timestamps: [], counts: [] })
  const activeRunRef = useRef<Run | null>(null)
  const equilibriumRunId = useRef<number | null>(null)

  const loadMeasurements = useCallback(async (run: Run | null) => {
    const now = Date.now()
    const from = run ? run.startedAt : now - MONITOR_SPAN_MS
    const loaded = await api.getMeasurements(from, now + 60_000)
    // Keep measurements that arrived by event while query ran (newer than last loaded measurement)
    const lastLoaded = loaded.timestamps.length > 0 ? loaded.timestamps[loaded.timestamps.length - 1] : -Infinity
    const current = measurements.current
    for (let index = 0; index < current.timestamps.length; index++) {
      if (current.timestamps[index] > lastLoaded && current.timestamps[index] >= from) {
        loaded.timestamps.push(current.timestamps[index])
        loaded.counts.push(current.counts[index])
      }
    }
    measurements.current = loaded
    setMarkers(run ? await api.getMarkers(run.id) : [])
    setMeasurementsVersion((version) => version + 1)
  }, [])

  const applyRun = useCallback(
    async (run: Run) => {
      const previous = activeRunRef.current
      if (run.status === "running") {
        activeRunRef.current = run
        setActiveRun(run)
        if (previous?.id !== run.id) {
          setEquilibriumAt(null)
          await loadMeasurements(run)
        } else {
          setMarkers(await api.getMarkers(run.id))
        }
        return
      }
      if (previous?.id === run.id) {
        activeRunRef.current = null
        setActiveRun(null)
        setRecoveredRun(null)
        setLastRun(run)
        setLastResult(await api.getRunResult(run.id))
        await loadMeasurements(null)
      }
    },
    [loadMeasurements],
  )

  useEffect(() => {
    let disposed = false
    const unlisteners: Promise<() => void>[] = []

    async function initialize() {
      const snapshot = await api.getSnapshot()
      if (disposed) return
      setConnection(snapshot.connection)
      setSettings(snapshot.settings)
      setMessages(snapshot.messages)
      activeRunRef.current = snapshot.activeRun
      setActiveRun(snapshot.activeRun)
      setRecoveredRun(snapshot.activeRun)
      await loadMeasurements(snapshot.activeRun)
      const lastIndex = measurements.current.timestamps.length - 1
      if (lastIndex >= 0 && Date.now() - measurements.current.timestamps[lastIndex] < 5000) {
        setLatest({ timestamp: measurements.current.timestamps[lastIndex], count: measurements.current.counts[lastIndex] })
      }
      setReady(true)
    }

    unlisteners.push(
      events.onMeasurement((measurement) => {
        const current = measurements.current
        current.timestamps.push(measurement.timestamp)
        current.counts.push(measurement.count)
        if (!activeRunRef.current) {
          const cutoff = measurement.timestamp - MONITOR_SPAN_MS
          let drop = 0
          while (drop < current.timestamps.length && current.timestamps[drop] < cutoff) drop++
          if (drop > 0) {
            current.timestamps.splice(0, drop)
            current.counts.splice(0, drop)
          }
        }
        setLatest(measurement)
        setMeasurementsVersion((version) => version + 1)
      }),
      events.onConnection(setConnection),
      events.onMessage((message) => setMessages((list) => [...list.slice(-(MESSAGE_LIMIT - 1)), message])),
      events.onRun((run) => void applyRun(run)),
    )
    void initialize()

    return () => {
      disposed = true
      unlisteners.forEach((unlisten) => void unlisten.then((dispose) => dispose()))
    }
  }, [applyRun, loadMeasurements])

  // Equilibrium detection during run; reported once per run
  useEffect(() => {
    const run = activeRun
    if (!run || !settings || equilibriumRunId.current === run.id) return
    const series = runSeries(run, measurements.current)
    const reached = detectEquilibrium(series, {
      bandPercent: settings.equilibriumBandPercent,
      durationS: settings.equilibriumDurationS,
      baselineWindowS: run.parameters.baselineWindowS,
      delayS: run.parameters.delayS,
    })
    if (reached !== null) {
      equilibriumRunId.current = run.id
      setEquilibriumAt(reached)
      void api.logMessage("info", `Equilibrium reached at ${formatDuration(reached)}`)
    }
  }, [activeRun, settings, measurementsVersion])

  const state: MonitorState = {
    ready,
    connection,
    settings,
    activeRun,
    recoveredRun,
    messages,
    latest,
    measurements: measurements.current,
    measurementsVersion,
    markers,
    equilibriumAt,
    lastRun,
    lastResult,
  }

  return {
    state,
    setSettings,
    dismissRecovery: () => setRecoveredRun(null),
    applyRun,
  }
}
