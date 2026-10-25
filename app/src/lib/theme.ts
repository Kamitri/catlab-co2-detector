export const CHART_FONT = "Geist Variable, ui-sans-serif, system-ui, sans-serif"

/** Chart colors of one theme; first series color matches --primary in index.css. */
export interface ChartPalette {
  series: string[]
  text: string
  muted: string
  grid: string
  /** Background of hover label and label of newest data point. */
  label: string
}

const LIGHT: ChartPalette = {
  series: ["#007e85", "#e0533d", "#3f9b4f", "#d99a1e", "#7a5cd6", "#2f6fd0", "#c94f8c", "#5f6b74"],
  text: "#121c23",
  muted: "#5f6b74",
  grid: "#e7ecee",
  label: "#ffffff",
}

const DARK: ChartPalette = {
  series: ["#3cc2c8", "#ff7a63", "#5fc46f", "#f0b43c", "#a08cf0", "#5f9bf0", "#e77ab0", "#9aa7b0"],
  text: "#e6eef1",
  muted: "#9aa9b2",
  grid: "#2a3a42",
  label: "#1b2a31",
}

export function chartPalette(dark: boolean): ChartPalette {
  return dark ? DARK : LIGHT
}
