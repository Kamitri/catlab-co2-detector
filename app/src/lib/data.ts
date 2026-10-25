import type { Measurements, Run } from "@/lib/api"

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

export function runSeries(run: Run, measurements: Measurements): Series {
  return {
    x: measurements.timestamps.map((timestamp) => (timestamp - run.startedAt) / 1000),
    y: measurements.counts.map((count) => concentration(count, run.conversionScale, run.conversionExponent)),
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
  /** C<sub>0</sub> window: equilibrium is checked over same interval that C<sub>0</sub> is averaged over. */
  windowS: number
  delayS: number
}

/**
 * Returns elapsed time (s) at which concentration became stable, or null.
 * Stable: over last `windowS`, (max - min) / mean is within maximum variation, and mean is at least twice baseline
 * (minimum of run), so flat baseline before breakthrough is not detected.
 */
export function detectEquilibrium(series: Series, options: EquilibriumOptions): number | null {
  const { x, y } = series
  if (x.length < 2) return null
  const end = x[x.length - 1]
  if (end - options.delayS < options.windowS) return null
  // Loop instead of Math.min(...y): spread of long run exceeds argument limit
  const baseline = y.reduce((lowest, value) => Math.min(lowest, value), Infinity)

  let minimum = Infinity
  let maximum = -Infinity
  let sum = 0
  let count = 0
  let first = end
  for (let index = x.length - 1; index >= 0 && x[index] >= end - options.windowS; index--) {
    minimum = Math.min(minimum, y[index])
    maximum = Math.max(maximum, y[index])
    sum += y[index]
    count++
    first = x[index]
  }
  // Window must be covered by data, not by one sample after long gap
  if (end - first < 0.9 * options.windowS) return null
  const mean = sum / count
  if (mean < 2 * baseline) return null
  return ((maximum - minimum) / mean) * 100 <= options.bandPercent ? end : null
}
