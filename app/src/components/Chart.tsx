import Plotly from "plotly.js-dist-min"
import { useEffect, useRef, useState } from "react"

import { useDarkMode } from "@/hooks/useTheme"
import { CHART_FONT, chartPalette } from "@/lib/theme"
import { timeTicks, type View } from "@/lib/view"

export interface ChartTrace {
  name: string
  x: (number | null)[]
  y: (number | null)[]
  color?: string
  /** Per-point text for hover, for example clock time. */
  customdata?: (string | null)[]
  hovertemplate?: string
}

export interface ChartMarker {
  x: number
  label: string
}

/** Newest data point; shown with line and label while pointer is outside chart. */
export interface ChartLatest {
  x: number
  y: number
  /** Label text; `<br>` separates lines. */
  text: string
}

export type DragMode = "zoom" | "pan"

interface ChartProps {
  traces: ChartTrace[]
  xTitle: string
  yTitle: string
  markers?: ChartMarker[]
  /** Changes on every data update; Plotly redraws data only when it changes. */
  revision: number | string
  view: View
  /** Called after zoom, pan, or wheel zoom by user. */
  onViewChange: (view: View) => void
  dragMode: DragMode
  showLegend?: boolean
  /** Clock time (ms) at x = 0 s; when set, top axis shows clock time. */
  clockStart?: number
  latest?: ChartLatest
}

interface PlotElement extends HTMLDivElement {
  on?: (event: string, handler: () => void) => void
  layout?: { xaxis?: { range?: [number, number] }; yaxis?: { range?: [number, number] } }
  _fullLayout?: {
    _size: { w: number; h: number }
    xaxis: { range: [number, number] }
    yaxis: { range: [number, number] }
  }
}

/** Clock axis value (ms since epoch) for x (s). Plotly shows ms values on date axis in local time. */
function clockValue(clockStart: number, seconds: number): number {
  return clockStart + seconds * 1000
}

/** Space pans only when focus is outside text fields and when a dialog is not open. */
function spaceTargetsChart(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null
  if (target?.closest("input, textarea, select, [contenteditable=true]")) return false
  return document.querySelector("[role=dialog], [role=alertdialog]") === null
}

export function Chart({
  traces,
  xTitle,
  yTitle,
  markers = [],
  revision,
  view,
  onViewChange,
  dragMode,
  showLegend = false,
  clockStart,
  latest,
}: ChartProps) {
  const container = useRef<PlotElement>(null)
  const viewHandler = useRef(onViewChange)
  viewHandler.current = onViewChange
  const clockStartRef = useRef(clockStart)
  clockStartRef.current = clockStart
  // True while Plotly.react applies view from props; relayout events then come from app, not user
  const applying = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const palette = chartPalette(useDarkMode())
  // Pointer on chart shows hover line of Plotly; outside chart, line at newest data point is shown
  const [pointerInside, setPointerInside] = useState(false)
  const showLatest = latest !== undefined && !pointerInside

  useEffect(() => {
    const element = container.current
    if (!element) return
    const data: Partial<Plotly.PlotData>[] = traces.map((trace, index) => ({
      type: "scatter",
      mode: "lines",
      name: trace.name,
      x: trace.x,
      y: trace.y,
      customdata: trace.customdata as Plotly.Datum[] | undefined,
      connectgaps: false,
      line: { color: trace.color ?? palette.series[index % palette.series.length], width: 1.75 },
      hovertemplate: trace.hovertemplate ?? "%{y:,.4~f}<extra>%{fullData.name}</extra>",
    }))
    // Empty trace makes Plotly draw clock axis
    if (clockStart !== undefined) {
      data.push({ type: "scatter", x: [], y: [], xaxis: "x2", hoverinfo: "skip", showlegend: false })
    }
    const ticks = timeTicks(view.x[1] - view.x[0])
    const axis = {
      gridcolor: palette.grid,
      // Line at 0 stands out from grid lines
      zeroline: true,
      zerolinecolor: palette.zero,
      zerolinewidth: 2,
      linecolor: palette.grid,
      // Axis line at plot edge would hide zero line at same position
      showline: false,
      tickcolor: palette.grid,
      tickfont: { color: palette.muted, size: 11 },
      automargin: true,
      autorange: false,
    }
    const shapes: Partial<Plotly.Shape>[] = markers.map((marker) => ({
      type: "line",
      xref: "x",
      yref: "paper",
      x0: marker.x,
      x1: marker.x,
      y0: 0,
      y1: 1,
      line: { color: palette.muted, width: 1, dash: "dot" },
    }))
    const annotations: Partial<Plotly.Annotations>[] = markers.map((marker) => ({
      x: marker.x,
      xref: "x",
      yref: "paper",
      y: 1,
      // Label is inside plot area below top edge, clear of clock axis tick labels
      yanchor: "top",
      // Label starts at marker line and extends right, clear of y axis tick labels
      xanchor: "left",
      xshift: 2,
      text: marker.label,
      showarrow: false,
      bgcolor: palette.label,
      font: { size: 11, color: palette.muted },
    }))
    if (showLatest) {
      // Same line as hover line of Plotly; label on side of line with more room
      const right = latest.x > view.x[0] + 0.7 * (view.x[1] - view.x[0])
      shapes.push({
        type: "line",
        xref: "x",
        yref: "paper",
        x0: latest.x,
        x1: latest.x,
        y0: 0,
        y1: 1,
        line: { color: palette.text, width: 1, dash: "dot" },
      })
      annotations.push({
        x: latest.x,
        y: latest.y,
        xref: "x",
        yref: "y",
        xanchor: right ? "right" : "left",
        xshift: right ? -8 : 8,
        text: latest.text,
        align: "left",
        showarrow: false,
        bgcolor: palette.label,
        bordercolor: palette.grid,
        borderpad: 4,
        font: { size: 12, color: palette.text },
      })
    }
    const layout: Partial<Plotly.Layout> = {
      datarevision: revision,
      dragmode: spaceHeld ? "pan" : dragMode,
      font: { family: CHART_FONT, size: 12, color: palette.text },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 64, r: 16, t: clockStart === undefined ? 24 : 36, b: 48 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: palette.label, bordercolor: palette.grid, font: { family: CHART_FONT, color: palette.text } },
      showlegend: showLegend,
      legend: { orientation: "h", x: 0, y: 1.08, font: { size: 11 } },
      xaxis: {
        ...axis,
        type: "linear",
        range: [...view.x],
        title: { text: xTitle, font: { size: 12, color: palette.muted } },
        tick0: 0,
        dtick: ticks.label,
        minor: { dtick: ticks.grid, showgrid: true, gridcolor: palette.minorGrid },
        hoverformat: ",.0f",
        tickformat: ",~r",
      },
      // Overlaid axis pans and zooms with x axis during drag. Key is left out without clock
      // time: Plotly fails on `xaxis2: undefined`.
      ...(clockStart !== undefined && {
        xaxis2: {
          ...axis,
          type: "date",
          overlaying: "x",
          side: "top",
          range: [clockValue(clockStart, view.x[0]), clockValue(clockStart, view.x[1])],
          showgrid: false,
          tickformat: "%H:%M:%S",
        },
      }),
      yaxis: {
        ...axis,
        range: [...view.y],
        title: { text: yTitle, font: { size: 12, color: palette.muted } },
        tickformat: ",~r",
      },
      shapes,
      annotations,
    }
    // showTips off: Plotly tip "Double-click to zoom back out" does not apply, double-click is off
    const config: Partial<Plotly.Config> = {
      displayModeBar: false,
      scrollZoom: true,
      responsive: true,
      doubleClick: false,
      showTips: false,
    }
    applying.current = true
    void Plotly.react(element, data, layout, config).finally(() => {
      applying.current = false
    })
  }, [traces, xTitle, yTitle, markers, revision, view, dragMode, spaceHeld, showLegend, clockStart, latest, showLatest, palette])

  // Zoom, pan, and wheel zoom by user report new view
  useEffect(() => {
    const element = container.current
    if (!element) return
    const handle = () => {
      if (applying.current) return
      const x = element.layout?.xaxis?.range
      const y = element.layout?.yaxis?.range
      if (x && y) viewHandler.current({ x: [Number(x[0]), Number(x[1])], y: [Number(y[0]), Number(y[1])] })
    }
    // Plotly attaches `on` during first render
    const timer = window.setTimeout(() => element.on?.("plotly_relayout", handle), 0)
    return () => window.clearTimeout(timer)
  }, [])

  // Middle mouse button drag pans, independent of selected tool
  useEffect(() => {
    const element = container.current
    if (!element) return
    let frame = 0
    const start = (event: MouseEvent) => {
      const layout = element._fullLayout
      if (event.button !== 1 || !layout) return
      event.preventDefault()
      event.stopPropagation()
      const origin = { clientX: event.clientX, clientY: event.clientY, x: [...layout.xaxis.range], y: [...layout.yaxis.range] }
      const { w: width, h: height } = layout._size
      element.style.cursor = "grabbing"
      const move = (moveEvent: MouseEvent) => {
        const shiftX = ((moveEvent.clientX - origin.clientX) / width) * (origin.x[1] - origin.x[0])
        const shiftY = ((moveEvent.clientY - origin.clientY) / height) * (origin.y[1] - origin.y[0])
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(() => {
          const x: [number, number] = [origin.x[0] - shiftX, origin.x[1] - shiftX]
          const clock = clockStartRef.current
          void Plotly.relayout(element, {
            "xaxis.range": x,
            "yaxis.range": [origin.y[0] + shiftY, origin.y[1] + shiftY],
            ...(clock === undefined ? {} : { "xaxis2.range": [clockValue(clock, x[0]), clockValue(clock, x[1])] }),
          })
        })
      }
      const end = (endEvent: MouseEvent) => {
        if (endEvent.button !== 1) return
        element.style.cursor = ""
        window.removeEventListener("mousemove", move)
        window.removeEventListener("mouseup", end)
      }
      window.addEventListener("mousemove", move)
      window.addEventListener("mouseup", end)
    }
    // Middle click would otherwise start automatic scrolling of WebView
    const preventAutoscroll = (event: MouseEvent) => {
      if (event.button === 1) event.preventDefault()
    }
    element.addEventListener("mousedown", start, true)
    element.addEventListener("auxclick", preventAutoscroll)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener("mousedown", start, true)
      element.removeEventListener("auxclick", preventAutoscroll)
    }
  }, [])

  // Space key down switches drag to pan, as in drawing programs
  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || !spaceTargetsChart(event)) return
      event.preventDefault()
      if (document.activeElement instanceof HTMLButtonElement) document.activeElement.blur()
      if (!event.repeat) setSpaceHeld(true)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code !== "Space") return
      if (spaceTargetsChart(event)) event.preventDefault()
      setSpaceHeld(false)
    }
    const release = () => setSpaceHeld(false)
    window.addEventListener("keydown", down)
    window.addEventListener("keyup", up)
    window.addEventListener("blur", release)
    return () => {
      window.removeEventListener("keydown", down)
      window.removeEventListener("keyup", up)
      window.removeEventListener("blur", release)
    }
  }, [])

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(() => void Plotly.Plots.resize(element))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = container.current
    return () => {
      if (element) Plotly.purge(element)
    }
  }, [])

  return (
    <div
      ref={container}
      className="h-full w-full"
      onMouseEnter={() => setPointerInside(true)}
      onMouseLeave={() => setPointerInside(false)}
    />
  )
}
