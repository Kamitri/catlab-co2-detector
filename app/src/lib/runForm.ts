import type { RunParameters } from "@/lib/api"

export const NUMERIC_KEYS = [
  "massG",
  "densityGMl",
  "pressureBar",
  "temperatureC",
  "delayS",
  "coWindowS",
  "soapVolumeMl",
] as const

export type NumericKey = (typeof NUMERIC_KEYS)[number]

const POSITIVE_KEYS: NumericKey[] = ["massG", "densityGMl", "pressureBar", "coWindowS", "soapVolumeMl"]

/** Decimal places of fields set by precision of equipment (balance, soap film flowmeter) in Settings. */
export type Decimals = Partial<Record<NumericKey, number>>

export const DEFAULT_DECIMALS: Decimals = { massG: 4, soapVolumeMl: 1 }

/** Number of soap film time fields shown when fewer times are stored. */
export const SOAP_TIME_COUNT = 10

/** Run parameters as form text; numeric fields stay text until submit to allow partial input such as "0.". */
export type RunFormValues = Omit<RunParameters, NumericKey | "soapTimesS"> &
  Record<NumericKey, string> & { soapTimesS: string[] }

export function toFormValues(parameters: RunParameters, decimals: Decimals = DEFAULT_DECIMALS): RunFormValues {
  const values = { ...parameters } as unknown as RunFormValues
  for (const key of NUMERIC_KEYS) {
    const value = parameters[key]
    const places = decimals[key]
    values[key] = places !== undefined && Number.isFinite(value) ? value.toFixed(places) : String(value ?? "")
  }
  const times = (parameters.soapTimesS ?? []).map(String)
  while (times.length < SOAP_TIME_COUNT) times.push("")
  values.soapTimesS = times
  return values
}

/** Parses decimal number; accepts comma as decimal separator. Empty text is NaN. */
export function parseNumber(text: string): number {
  return text.trim() === "" ? Number.NaN : Number(text.trim().replace(",", "."))
}

/** Flow rate (mL/min) of one soap film time, same as `soap_flow_rate` in calculation.rs. */
export function soapFlowRate(volumeMl: number, timeS: number): number {
  return (60 * volumeMl) / timeS
}

export function soapTimeKey(index: number): string {
  return `soapTime-${index}`
}

export function fieldErrors(values: RunFormValues): Set<string> {
  const errors = new Set<string>()
  if (!values.sample.trim()) errors.add("sample")
  for (const key of NUMERIC_KEYS) {
    const value = parseNumber(values[key])
    if (!Number.isFinite(value) || value < 0 || (POSITIVE_KEYS.includes(key) && value === 0)) errors.add(key)
  }
  values.soapTimesS.forEach((text, index) => {
    if (text.trim() !== "" && !(parseNumber(text) > 0)) errors.add(soapTimeKey(index))
  })
  return errors
}

/** Soap film flow rates (mL/min) of valid times. */
export function soapFlowRates(values: RunFormValues): number[] {
  const volume = parseNumber(values.soapVolumeMl)
  return values.soapTimesS
    .map(parseNumber)
    .filter((time) => time > 0)
    .map((time) => soapFlowRate(volume, time))
}

export function toParameters(values: RunFormValues): RunParameters {
  const parameters = { ...values } as unknown as RunParameters
  for (const key of NUMERIC_KEYS) parameters[key] = parseNumber(values[key])
  parameters.soapTimesS = values.soapTimesS.map(parseNumber).filter((time) => time > 0)
  return parameters
}
