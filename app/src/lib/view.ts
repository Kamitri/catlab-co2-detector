/** Visible range of chart axes. */
export interface View {
  x: [number, number]
  y: [number, number]
}

/** Time axis outside run: 0 to 5000 s, end increases by 1000 s when newest point comes within 1000 s of end. */
export const MONITOR_TIME_AXIS: TimeAxis = { end: 5000, step: 1000 }
/** Time axis during run: 0 to 2000 s, end increases by 500 s. Run reaches equilibrium in about 2000 s. */
export const RUN_TIME_AXIS: TimeAxis = { end: 2000, step: 500 }
export const DEFAULT_CO2_RANGE: [number, number] = [0, 40000]
export const DEFAULT_RATIO_RANGE: [number, number] = [0, 1.2]

/** Default end of time axis (s), and step by which end increases. */
export interface TimeAxis {
  end: number
  step: number
}

/**
 * End of default time axis for newest time (s). Starts at axis end; when newest point is within one step
 * of end, end increases by one step. Axis start stays at 0, keeping view still between updates.
 */
export function timeAxisEnd(lastTime: number, axis: TimeAxis = MONITOR_TIME_AXIS): number {
  if (!Number.isFinite(lastTime)) return axis.end
  return Math.max(axis.end, (Math.floor(lastTime / axis.step) + 2) * axis.step)
}

export function defaultView(
  lastTime: number,
  y: [number, number] = DEFAULT_CO2_RANGE,
  axis: TimeAxis = MONITOR_TIME_AXIS,
): View {
  return { x: [0, timeAxisEnd(lastTime, axis)], y }
}

/**
 * Label step and grid step of time axis for visible width (s): about 10 labels at round step (1, 2 or 5 x 10^n),
 * with 4 or 5 grid lines between labels. 0-5000 s gives labels every 500 s and grid lines every 100 s.
 */
export function timeTicks(width: number): { label: number; grid: number } {
  if (!(width > 0)) return { label: 500, grid: 100 }
  const target = width / 10
  const power = 10 ** Math.floor(Math.log10(target))
  const factor = [5, 2, 1].find((candidate) => candidate * power <= target) ?? 1
  const label = factor * power
  return { label, grid: label / (factor === 2 ? 4 : 5) }
}
