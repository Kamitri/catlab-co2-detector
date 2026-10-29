import type { FlowEntry, RunParameters } from "@/lib/api"

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

/** Decimal places of fields set by precision of equipment (balance, soap film flowmeter, timer) in Settings. */
export type Decimals = Partial<Record<NumericKey | "soapTimeS", number>>

export const DEFAULT_DECIMALS: Decimals = { massG: 4, soapVolumeMl: 1, soapTimeS: 2 }

/** Flow rate entry from Settings: number of soap film time fields, and soap film times or flow rate. */
export interface FlowOptions {
  count: number
  entry: FlowEntry
}

export const DEFAULT_FLOW_OPTIONS: FlowOptions = { count: 10, entry: "soapFilm" }

/**
 * Run parameters as form text; numeric fields stay text until submit to allow partial input such as "0.".
 * `flowEntry` is form state only: fields for soap film times or for flow rate.
 */
export type RunFormValues = Omit<RunParameters, NumericKey | "soapTimesS" | "flowRateMlMin"> &
  Record<NumericKey, string> & { soapTimesS: string[]; flowRateMlMin: string; flowEntry: FlowEntry }

/**
 * Value with given decimal places when that does not change it; otherwise full value. Stored value with more
 * decimals than precision in Settings (for example after precision change) is not rounded when form is saved.
 */
function fixedWithoutRounding(value: number, places: number): string {
  const fixed = value.toFixed(places)
  return Number(fixed) === value ? fixed : String(value)
}

/**
 * Entry of run that has data: run with soap film times keeps time fields and run with flow rate keeps flow rate
 * field, whatever entry is in Settings. Run without either uses entry of Settings.
 */
export function runFlowEntry(parameters: RunParameters, entry: FlowEntry): FlowEntry {
  if ((parameters.soapTimesS ?? []).length > 0) return "soapFilm"
  if (parameters.flowRateMlMin > 0) return "flowRate"
  return entry
}

export function toFormValues(
  parameters: RunParameters,
  decimals: Decimals = DEFAULT_DECIMALS,
  options: FlowOptions = DEFAULT_FLOW_OPTIONS,
): RunFormValues {
  const values = { ...parameters } as unknown as RunFormValues
  for (const key of NUMERIC_KEYS) {
    const value = parameters[key]
    const places = decimals[key]
    values[key] = places !== undefined && Number.isFinite(value) ? fixedWithoutRounding(value, places) : String(value ?? "")
  }
  const places = decimals.soapTimeS
  const times = (parameters.soapTimesS ?? []).map((time) => (places === undefined ? String(time) : fixedWithoutRounding(time, places)))
  while (times.length < options.count) times.push("")
  values.soapTimesS = times
  values.flowRateMlMin = parameters.flowRateMlMin > 0 ? String(parameters.flowRateMlMin) : ""
  values.flowEntry = options.entry
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
  if (values.flowRateMlMin.trim() !== "" && !(parseNumber(values.flowRateMlMin) > 0)) errors.add("flowRateMlMin")
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
  const { flowEntry, ...rest } = values
  const parameters = rest as unknown as RunParameters
  for (const key of NUMERIC_KEYS) parameters[key] = parseNumber(values[key])
  // Flow rate entry: entered flow rate replaces soap film times, which calculation would use first
  parameters.soapTimesS =
    flowEntry === "flowRate" ? [] : values.soapTimesS.map(parseNumber).filter((time) => time > 0)
  const flowRate = parseNumber(values.flowRateMlMin)
  parameters.flowRateMlMin = flowRate > 0 ? flowRate : 0
  return parameters
}
