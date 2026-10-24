import type { Readings, Run } from "@/lib/api"

export const VENDOR_SCALE = 1785.9
export const VENDOR_EXPONENT = 0.0111

/** Interval longer than this counts as gap and breaks chart line (ms). */
export const GAP_THRESHOLD_MS = 1500

export function concentration(count: number, scale: number, exponent: number): number {
  return scale * Math.exp(exponent * count)
}

export interface Series {
  /** Elapsed time since run start (s), or timestamp (ms) outside run. */
  x: number[]
  /** CO₂ (ppmv). */
  y: number[]
}

export function runSeries(run: Run, readings: Readings): Series {
  return {
    x: readings.timestamps.map((timestamp) => (timestamp - run.startedAt) / 1000),
    y: readings.counts.map((count) => concentration(count, run.conversionScale, run.conversionExponent)),
  }
}

/** Inserts null after each gap so chart line breaks instead of bridging missing data. */
export function withGaps(x: number[], y: number[], threshold: number): { x: (number | null)[]; y: (number | null)[] } {
  const gappedX: (number | null)[] = []
  const gappedY: (number | null)[] = []
  for (let index = 0; index < x.length; index++) {
    if (index > 0 && x[index] - x[index - 1] > threshold) {
      gappedX.push((x[index] + x[index - 1]) / 2)
      gappedY.push(null)
    }
    gappedX.push(x[index])
    gappedY.push(y[index])
  }
  return { x: gappedX, y: gappedY }
}

export interface EquilibriumOptions {
  bandPercent: number
  durationS: number
  baselineWindowS: number
  delayS: number
}

/**
 * Returns elapsed time (s) at which concentration became stable, or null.
 * Stable: over last `durationS`, (max - min) / mean is within band, and mean is at least twice baseline
 * (so flat baseline before breakthrough is not detected).
 */
export function detectEquilibrium(series: Series, options: EquilibriumOptions): number | null {
  const { x, y } = series
  if (x.length < 2) return null
  const end = x[x.length - 1]
  if (end - options.delayS < options.durationS) return null

  let baselineSum = 0
  let baselineCount = 0
  for (let index = 0; index < x.length && x[index] <= options.baselineWindowS; index++) {
    baselineSum += y[index]
    baselineCount++
  }
  if (baselineCount === 0) return null
  const baseline = baselineSum / baselineCount

  let minimum = Infinity
  let maximum = -Infinity
  let sum = 0
  let count = 0
  let first = end
  for (let index = x.length - 1; index >= 0 && x[index] >= end - options.durationS; index--) {
    minimum = Math.min(minimum, y[index])
    maximum = Math.max(maximum, y[index])
    sum += y[index]
    count++
    first = x[index]
  }
  // Window must be covered by data, not by one sample after long gap
  if (end - first < 0.9 * options.durationS) return null
  const mean = sum / count
  if (mean < 2 * baseline) return null
  return ((maximum - minimum) / mean) * 100 <= options.bandPercent ? end : null
}
