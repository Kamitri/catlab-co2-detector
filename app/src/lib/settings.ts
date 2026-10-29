import type { Settings } from "@/lib/api"
import { VENDOR_EXPONENT, VENDOR_SCALE } from "@/lib/data"

/** Same values as Default of Settings in model.rs; empty export folder means default folder. */
export const DEFAULT_SETTINGS: Settings = {
  exportFolder: "",
  fileNamePattern: "{date}_{time}_{sample}",
  coWindowS: 300,
  equilibriumVariationPpm: 1000,
  conversionScale: VENDOR_SCALE,
  conversionExponent: VENDOR_EXPONENT,
  extraPorts: [],
  retentionDays: 30,
  massPrecisionG: 0.0001,
  soapVolumePrecisionMl: 0.1,
  soapTimePrecisionS: 0.01,
  soapTimeCount: 10,
  flowEntry: "soapFilm",
  theme: "light",
}

/** Decimal places that show every multiple of precision step, same as `decimals` in model.rs: 0.0001 -> 4, 0.5 -> 1. */
export function decimals(step: number): number {
  if (!(step > 0) || !Number.isFinite(step)) return 0
  let places = 0
  while (places < 8 && Math.abs(Math.round(step * 10 ** places) - step * 10 ** places) > 1e-9 * 10 ** places) places++
  return places
}
