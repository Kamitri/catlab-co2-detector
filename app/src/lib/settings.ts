import type { Settings } from "@/lib/api"
import { VENDOR_EXPONENT, VENDOR_SCALE } from "@/lib/data"

/** Same values as Default of Settings in model.rs; empty export folder means default folder. */
export const DEFAULT_SETTINGS: Settings = {
  exportFolder: "",
  fileNamePattern: "{date}_{time}_{sample}",
  coWindowS: 300,
  equilibriumBandPercent: 3,
  conversionScale: VENDOR_SCALE,
  conversionExponent: VENDOR_EXPONENT,
  extraPorts: [],
  retentionDays: 30,
  massPrecisionG: 0.0001,
  soapVolumePrecisionMl: 0.1,
  theme: "light",
}

/** Decimal places of precision step, same as `decimals` in model.rs: 0.0001 -> 4, 0.1 -> 1. */
export function decimals(step: number): number {
  return step > 0 && Number.isFinite(step) ? Math.min(8, Math.max(0, Math.round(-Math.log10(step)))) : 0
}
