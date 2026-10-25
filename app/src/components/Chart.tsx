import Plotly from "plotly.js-dist-min"
import { useEffect, useRef, useState } from "react"

import { CHART_COLORS, CHART_FONT, GRID_COLOR, MUTED_COLOR, TEXT_COLOR } from "@/lib/theme"
import type { View } from "@/lib/view"

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

export type DragMode = "zoom" | "pan"

interface ChartProps {
  traces: ChartTrace[]
  xTitle: string
  yTitle: string
  markers?: ChartMarker[]
  /** Changes on every data update. */
  revision: number
  view: View
  /** Called after zoom, pan, or wheel zoom by user. */
  onViewChange: (view: View) => void
  dragMode: DragMode
  showLegend?: boolean
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
}: ChartProps) {
  const container = useRef<PlotElement>(null)
  const viewHandler = useRef(onViewChange)
  viewHandler.current = onViewChange
  // True while Plotly.react applies view from props; relayout events then come from app, not user
  const applying = useRef(false)
  const [spaceHeld, setSpaceHeld] = useState(false)

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
      line: { color: trace.color ?? CHART_COLORS[index % CHART_COLORS.length], width: 1.75 },
      hovertemplate: trace.hovertemplate ?? "%{y:,.4~f}<extra>%{fullData.name}</extra>",
    }))
    const axis = {
      gridcolor: GRID_COLOR,
      zeroline: false,
      linecolor: GRID_COLOR,
      tickcolor: GRID_COLOR,
      tickfont: { color: MUTED_COLOR, size: 11 },
      automargin: true,
      autorange: false,
    }
    const layout: Partial<Plotly.Layout> = {
      datarevision: revision,
      dragmode: spaceHeld ? "pan" : dragMode,
      font: { family: CHART_FONT, size: 12, color: TEXT_COLOR },
      paper_bgcolor: "rgba(0,0,0,0)",
      plot_bgcolor: "rgba(0,0,0,0)",
      margin: { l: 64, r: 16, t: 24, b: 48 },
      hovermode: "x unified",
      hoverlabel: { bgcolor: "#ffffff", bordercolor: GRID_COLOR, font: { family: CHART_FONT, color: TEXT_COLOR } },
      showlegend: showLegend,
      legend: { orientation: "h", x: 0, y: 1.08, font: { size: 11 } },
      xaxis: {
        ...axis,
        type: "linear",
        range: [...view.x],
        title: { text: xTitle, font: { size: 12, color: MUTED_COLOR } },
        hoverformat: ",.0f",
        tickformat: ",~r",
      },
      yaxis: {
        ...axis,
        range: [...view.y],
        title: { text: yTitle, font: { size: 12, color: MUTED_COLOR } },
        tickformat: ",~r",
      },
      shapes: markers.map((marker) => ({
        type: "line",
        xref: "x",
        yref: "paper",
        x0: marker.x,
        x1: marker.x,
        y0: 0,
        y1: 1,
        line: { color: MUTED_COLOR, width: 1, dash: "dot" },
      })),
      annotations: markers.map((marker) => ({
        x: marker.x,
        xref: "x",
        yref: "paper",
        y: 1,
        yanchor: "bottom",
        // Label starts at marker line and extends right, clear of y axis tick labels
        xanchor: "left",
        text: marker.label,
        showarrow: false,
        font: { size: 11, color: MUTED_COLOR },
      })),
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
  }, [traces, xTitle, yTitle, markers, revision, view, dragMode, spaceHeld, showLegend])

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
          void Plotly.relayout(element, {
            "xaxis.range": [origin.x[0] - shiftX, origin.x[1] - shiftX],
            "yaxis.range": [origin.y[0] + shiftY, origin.y[1] + shiftY],
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

  return <div ref={container} className="h-full w-full" />
}
