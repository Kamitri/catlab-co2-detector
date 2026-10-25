import { useMemo, useRef, useState } from "react"

import { Chart, type DragMode } from "@/components/Chart"
import { ChartControls } from "@/components/ChartControls"
import { Button } from "@/components/ui/button"
import { useChartView } from "@/hooks/useChartView"
import type { MonitorState } from "@/hooks/useMonitor"
import { concentration, GAP_THRESHOLD_MS, withGaps } from "@/lib/data"
import { formatClock } from "@/lib/format"
import { defaultView } from "@/lib/view"

const CO2_HOVER = "%{y:,.0f} ppm<extra></extra>"

interface LiveViewProps {
  state: MonitorState
  onSample: () => void
  onStart: () => void
  onMarker: () => void
  onFinish: () => void
  onAbort: () => void
  onClear: () => void
}

export function LiveView({ state, onSample, onStart, onMarker, onFinish, onAbort, onClear }: LiveViewProps) {
  const { activeRun, measurements, measurementsVersion, markers, settings, viewStart } = state
  const [dragMode, setDragMode] = useState<DragMode>("zoom")
  // Clock labels for hover outside run; only labels of new measurements are formatted on update
  const clockLabels = useRef<{ start: number; labels: string[] }>({ start: 0, labels: [] })

  const { traces, lastTime } = useMemo(() => {
    const scale = activeRun?.conversionScale ?? settings?.conversionScale ?? 1785.9
    const exponent = activeRun?.conversionExponent ?? settings?.conversionExponent ?? 0.0111
    const seconds = measurements.timestamps.map((timestamp) => (timestamp - viewStart) / 1000)
    const y = measurements.counts.map((count) => concentration(count, scale, exponent))
    const data = withGaps(seconds, y, GAP_THRESHOLD_MS / 1000)
    const lastTime = seconds.length > 0 ? seconds[seconds.length - 1] : 0
    if (activeRun) return { traces: [{ name: "CO<sub>2</sub>", ...data, hovertemplate: CO2_HOVER }], lastTime }

    const cache = clockLabels.current
    if (cache.start !== viewStart || cache.labels.length > measurements.timestamps.length) {
      clockLabels.current = { start: viewStart, labels: [] }
    }
    const labels = clockLabels.current.labels
    for (let index = labels.length; index < measurements.timestamps.length; index++) {
      labels.push(formatClock(measurements.timestamps[index]))
    }
    // Inserted gap points have y null; other points take next clock label in order
    let next = 0
    const customdata = data.y.map((value) => (value === null ? null : labels[next++]))
    const trace = { name: "CO<sub>2</sub>", ...data, customdata, hovertemplate: `%{customdata} · ${CO2_HOVER}` }
    return { traces: [trace], lastTime }
    // measurementsVersion marks in-place updates of measurements arrays
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun, settings, measurementsVersion, viewStart])

  const chartView = useChartView(defaultView(lastTime), `${activeRun?.id ?? "monitor"}-${viewStart}`)

  const chartMarkers = useMemo(
    () => markers.map((marker) => ({ x: (marker.timestamp - viewStart) / 1000, label: marker.label })),
    [markers, viewStart],
  )


  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-4 border-b px-4 py-2.5">
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={onSample}>
            Sample
          </Button>
          <span className="max-w-48 truncate text-[13px] text-muted-foreground">
            {(activeRun?.parameters ?? state.sample)?.sample}
          </span>
          <div className="mx-1 h-5 w-px bg-border" />
          {activeRun ? (
            <>
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
            <>
              <Button onClick={onStart} disabled={!state.ready || !state.sample}>
                Start
              </Button>
              <div className="mx-1 h-5 w-px bg-border" />
              <Button variant="destructive" onClick={onClear} disabled={!state.ready}>
                Clear chart
              </Button>
            </>
          )}
        </div>
        <ChartControls
          dragMode={dragMode}
          onDragModeChange={setDragMode}
          view={chartView.view}
          onViewChange={chartView.setView}
          onReset={chartView.reset}
          yLabel={
            <>
              CO<sub>2</sub>
            </>
          }
          yUnit="ppm"
        />
      </div>
      <div className="min-h-0 flex-1 p-2">
        <Chart
          traces={traces}
          xTitle="Time (s)"
          yTitle="CO<sub>2</sub> (ppm)"
          markers={chartMarkers}
          revision={measurementsVersion}
          view={chartView.view}
          onViewChange={chartView.setView}
          dragMode={dragMode}
          clockStart={viewStart}
        />
      </div>
    </div>
  )
}
