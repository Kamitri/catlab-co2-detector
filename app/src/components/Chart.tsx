import Plotly from "plotly.js-dist-min"
import { useEffect, useRef } from "react"

import { CHART_COLORS, CHART_FONT, GRID_COLOR, MUTED_COLOR, TEXT_COLOR } from "@/lib/theme"

export interface ChartTrace {
  name: string
  x: (number | string | null)[]
  y: (number | null)[]
  color?: string
}

export interface ChartMarker {
  x: number
  label: string
}

export type DragMode = "zoom" | "pan"

interface ChartProps {
  traces: ChartTrace[]
  xType: "date" | "linear"
  xTitle: string
  yTitle: string
  markers?: ChartMarker[]
  /** Changes on every data update. */
  revision: number
  /** Changing this resets zoom and pan to full view. */
  viewKey: string
  dragMode: DragMode
  showLegend?: boolean
}

export function Chart({
  traces,
  xType,
  xTitle,
  yTitle,
  markers = [],
  revision,
  viewKey,
  dragMode,
  showLegend = false,
}: ChartProps) {
  const container = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const data: Partial<Plotly.PlotData>[] = traces.map((trace, index) => ({
      type: "scatter",
      mode: "lines",
      name: trace.name,
      x: trace.x,
      y: trace.y,
      connectgaps: false,
      line: { color: trace.color ?? CHART_COLORS[index % CHART_COLORS.length], width: 1.75 },
      hovertemplate: xType === "date" ? "%{y:,.0f} ppm<extra></extra>" : "%{y:,.4~f}<extra>%{fullData.name}</extra>",
    }))
    const axis = {
      gridcolor: GRID_COLOR,
      zeroline: false,
      linecolor: GRID_COLOR,
      tickcolor: GRID_COLOR,
      tickfont: { color: MUTED_COLOR, size: 11 },
      automargin: true,
    }
    const layout: Partial<Plotly.Layout> = {
      uirevision: viewKey,
      datarevision: revision,
      dragmode: dragMode,
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
        type: xType,
        title: { text: xTitle, font: { size: 12, color: MUTED_COLOR } },
        hoverformat: xType === "date" ? "%H:%M:%S" : ".2f",
        tickformat: xType === "date" ? "%H:%M" : undefined,
      },
      yaxis: {
        ...axis,
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
        text: marker.label,
        showarrow: false,
        font: { size: 11, color: MUTED_COLOR },
      })),
    }
    const config: Partial<Plotly.Config> = { displayModeBar: false, scrollZoom: true, responsive: true, doubleClick: false }
    void Plotly.react(element, data, layout, config)
  }, [traces, xType, xTitle, yTitle, markers, revision, viewKey, dragMode, showLegend])

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
