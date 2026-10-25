import { useMemo, useState } from "react"

import { Chart, type DragMode } from "@/components/Chart"
import { Button } from "@/components/ui/button"
import type { MonitorState } from "@/hooks/useMonitor"
import { concentration, GAP_THRESHOLD_MS, withGaps } from "@/lib/data"
import { plotlyLocalTime } from "@/lib/format"

export function ChartControls({
  dragMode,
  onDragModeChange,
  onReset,
}: {
  dragMode: DragMode
  onDragModeChange: (mode: DragMode) => void
  onReset: () => void
}) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border p-0.5">
        {(["zoom", "pan"] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={dragMode === mode ? "secondary" : "ghost"}
            className="px-2.5"
            onClick={() => onDragModeChange(mode)}
          >
            {mode === "zoom" ? "Zoom" : "Pan"}
          </Button>
        ))}
      </div>
      <Button variant="outline" onClick={onReset}>
        Reset view
      </Button>
    </div>
  )
}

interface LiveViewProps {
  state: MonitorState
  onStart: () => void
  onValveOpen: () => void
  onMarker: () => void
  onFinish: () => void
  onAbort: () => void
}

export function LiveView({ state, onStart, onValveOpen, onMarker, onFinish, onAbort }: LiveViewProps) {
  const { activeRun, measurements, measurementsVersion, markers, settings } = state
  const [dragMode, setDragMode] = useState<DragMode>("zoom")
  const [resetCount, setResetCount] = useState(0)

  const traces = useMemo(() => {
    const scale = activeRun?.conversionScale ?? settings?.conversionScale ?? 1785.9
    const exponent = activeRun?.conversionExponent ?? settings?.conversionExponent ?? 0.0111
    const y = measurements.counts.map((count) => concentration(count, scale, exponent))
    if (activeRun) {
      const minutes = measurements.timestamps.map((timestamp) => (timestamp - activeRun.startedAt) / 60_000)
      const data = withGaps(minutes, y, GAP_THRESHOLD_MS / 60_000)
      return [{ name: "CO<sub>2</sub>", ...data }]
    }
    const data = withGaps(measurements.timestamps, y, GAP_THRESHOLD_MS)
    return [{ name: "CO<sub>2</sub>", x: data.x.map((timestamp) => plotlyLocalTime(timestamp!)), y: data.y }]
    // measurementsVersion marks in-place updates of measurements arrays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun, settings, measurementsVersion])

  const chartMarkers = useMemo(
    () =>
      activeRun ? markers.map((marker) => ({ x: (marker.timestamp - activeRun.startedAt) / 60_000, label: marker.label })) : [],
    [activeRun, markers],
  )

  const valveOpened = markers.some((marker) => marker.label === "Valve open")

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          {activeRun ? (
            <>
              <Button variant={valveOpened ? "outline" : "default"} onClick={onValveOpen}>
                Valve open
              </Button>
              <Button variant="outline" onClick={onMarker}>
                Add marker
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button onClick={onFinish}>
                Finish
              </Button>
              <Button variant="destructive" onClick={onAbort}>
                Abort
              </Button>
            </>
          ) : (
            <Button onClick={onStart} disabled={!state.ready}>
              Start
            </Button>
          )}
        </div>
        <ChartControls dragMode={dragMode} onDragModeChange={setDragMode} onReset={() => setResetCount((count) => count + 1)} />
      </div>
      <div className="min-h-0 flex-1 p-2">
        <Chart
          traces={traces}
          xType={activeRun ? "linear" : "date"}
          xTitle={activeRun ? "Time (min)" : "Time"}
          yTitle="CO<sub>2</sub> (ppm)"
          markers={chartMarkers}
          revision={measurementsVersion}
          viewKey={`${activeRun?.id ?? "monitor"}-${resetCount}`}
          dragMode={dragMode}
        />
      </div>
    </div>
  )
}
