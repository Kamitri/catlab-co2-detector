const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 })

export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

export function formatInteger(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "–"
  return integer.format(value)
}

/** Formats seconds as h:mm:ss. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "–"
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const rest = total % 60
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
}

/**
 * Formats timestamp (ms) as local date and time text for Plotly date axis.
 * Plotly interprets numbers on date axis as UTC, shifting axis by time zone offset.
 */
export function plotlyLocalTime(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number, length = 2) => String(value).padStart(length, "0")
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
  )
}

export function formatClock(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-GB", { hour12: false })
}

export function formatDateTime(timestamp: number | null | undefined): string {
  if (!timestamp) return "–"
  const date = new Date(timestamp)
  const day = date.toLocaleDateString("en-CA")
  return `${day} ${date.toLocaleTimeString("en-GB", { hour12: false, hour: "2-digit", minute: "2-digit" })}`
}
