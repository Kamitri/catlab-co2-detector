import type { RunParameters } from "@/lib/api"

export const NUMERIC_KEYS = [
  "flowRateMlMin",
  "massG",
  "densityGMl",
  "pressureBar",
  "temperatureC",
  "delayS",
  "baselineWindowS",
  "coWindowS",
] as const

export type NumericKey = (typeof NUMERIC_KEYS)[number]

const POSITIVE_KEYS: NumericKey[] = ["flowRateMlMin", "massG", "densityGMl", "pressureBar", "baselineWindowS", "coWindowS"]

/** Run parameters as form text; numeric fields stay text until submit to allow partial input such as "0.". */
export type RunFormValues = Omit<RunParameters, NumericKey | "flowMeasurements"> & Record<NumericKey, string>

export function toFormValues(parameters: RunParameters): RunFormValues {
  const values = { ...parameters } as unknown as RunFormValues
  for (const key of NUMERIC_KEYS) values[key] = String(parameters[key] ?? "")
  return values
}

/** Parses decimal number; accepts comma as decimal separator. Empty text is NaN. */
export function parseNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", "."))
}

export function fieldErrors(values: RunFormValues): Set<string> {
  const errors = new Set<string>()
  if (!values.sample.trim()) errors.add("sample")
  for (const key of NUMERIC_KEYS) {
    const value = parseNumber(values[key])
    if (!Number.isFinite(value) || value < 0 || (POSITIVE_KEYS.includes(key) && value === 0)) errors.add(key)
  }
  return errors
}

export function toParameters(values: RunFormValues, flowMeasurements: number[]): RunParameters {
  const parameters = { ...values, flowMeasurements } as unknown as RunParameters
  for (const key of NUMERIC_KEYS) parameters[key] = parseNumber(values[key])
  return parameters
}
