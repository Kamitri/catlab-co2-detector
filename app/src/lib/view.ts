/** Visible range of chart axes. */
export interface View {
  x: [number, number]
  y: [number, number]
}

/** Default time axis end (s). */
export const DEFAULT_TIME_MAX_S = 5000
/** Time axis end increases by this step when newest point comes within one step of axis end (s). */
export const TIME_STEP_S = 1000
export const DEFAULT_CO2_RANGE: [number, number] = [0, 40000]
export const DEFAULT_RATIO_RANGE: [number, number] = [0, 1.2]

/**
 * End of default time axis for newest time (s). Starts at 5000 s; when newest point is within
 * 1000 s of end, end increases by 1000 s. Axis start stays at 0, keeping view still between updates.
 */
export function timeAxisEnd(lastTime: number): number {
  if (!Number.isFinite(lastTime)) return DEFAULT_TIME_MAX_S
  return Math.max(DEFAULT_TIME_MAX_S, (Math.floor(lastTime / TIME_STEP_S) + 2) * TIME_STEP_S)
}

export function defaultView(lastTime: number, y: [number, number] = DEFAULT_CO2_RANGE): View {
  return { x: [0, timeAxisEnd(lastTime)], y }
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
