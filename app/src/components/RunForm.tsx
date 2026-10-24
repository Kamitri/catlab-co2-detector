import { useState } from "react"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { Run, RunParameters } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"

export const NUMERIC_FIELDS = [
  ["flowRateMlMin", "Flow rate (mL/min)"],
  ["massG", "Sorbent mass (g)"],
  ["densityGMl", "Sorbent density (g/mL)"],
  ["pressureBar", "Pressure (bar)"],
  ["temperatureC", "Temperature (°C)"],
  ["delayS", "Delay time (s)"],
  ["baselineWindowS", "Baseline window (s)"],
  ["coWindowS", <>C<sub>0</sub> window (s)</>],
] as const

type NumericKey = (typeof NUMERIC_FIELDS)[number][0]
const POSITIVE_FIELDS: NumericKey[] = ["flowRateMlMin", "massG", "densityGMl", "pressureBar", "baselineWindowS", "coWindowS"]

export type RunFormValues = Omit<RunParameters, NumericKey | "flowMeasurements"> & Record<NumericKey, string>

export function toFormValues(parameters: RunParameters): RunFormValues {
  const values = { ...parameters } as unknown as RunFormValues
  for (const [key] of NUMERIC_FIELDS) values[key] = String(parameters[key] ?? "")
  return values
}

export function parseNumber(text: string): number {
  const value = Number(text.trim().replace(",", "."))
  return text.trim() === "" ? Number.NaN : value
}

export function fieldErrors(values: RunFormValues): Set<string> {
  const errors = new Set<string>()
  if (!values.sample.trim()) errors.add("sample")
  for (const [key] of NUMERIC_FIELDS) {
    const value = parseNumber(values[key])
    if (!Number.isFinite(value) || (POSITIVE_FIELDS.includes(key) && value <= 0) || value < 0) errors.add(key)
  }
  return errors
}

export function toParameters(values: RunFormValues, flowMeasurements: number[]): RunParameters {
  const parameters = { ...values, flowMeasurements } as unknown as RunParameters
  for (const [key] of NUMERIC_FIELDS) parameters[key] = parseNumber(values[key])
  return parameters
}

export function useRunForm(initial: RunParameters) {
  const [values, setValues] = useState(() => toFormValues(initial))
  const set = <K extends keyof RunFormValues>(key: K, value: RunFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))
  return { values, setValues, set, errors: fieldErrors(values) }
}

export function Field({
  label,
  id,
  invalid,
  className,
  children,
}: {
  label: React.ReactNode
  id: string
  invalid?: boolean
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Label htmlFor={id} className={cn(invalid && "text-destructive")}>
        <span>{label}</span>
      </Label>
      {children}
    </div>
  )
}

interface RunFieldsProps {
  form: ReturnType<typeof useRunForm>
  blankRuns: Run[]
  showDelay: boolean
  showValidation: boolean
}

export function RunFields({ form, blankRuns, showDelay, showValidation }: RunFieldsProps) {
  const { values, set, errors } = form
  const invalid = (key: string) => showValidation && errors.has(key)
  const numericFields = NUMERIC_FIELDS.filter(([key]) => showDelay || key !== "delayS")

  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-3">
      <Field label="Sample" id="sample" invalid={invalid("sample")}>
        <Input
          id="sample"
          value={values.sample}
          aria-invalid={invalid("sample")}
          autoFocus
          onChange={(event) => set("sample", event.target.value)}
        />
      </Field>
      <Field label="Operator" id="operator">
        <Input id="operator" value={values.operator} onChange={(event) => set("operator", event.target.value)} />
      </Field>
      {numericFields.map(([key, label]) => (
        <Field key={key} label={label} id={key} invalid={invalid(key)}>
          <Input
            id={key}
            inputMode="decimal"
            value={values[key]}
            aria-invalid={invalid(key)}
            onChange={(event) => set(key, event.target.value)}
          />
        </Field>
      ))}
      <Field label="Blank run" id="blankRun">
        <Select
          value={values.blankRunId === null ? "none" : String(values.blankRunId)}
          onValueChange={(value) => set("blankRunId", value === "none" ? null : Number(value))}
        >
          <SelectTrigger id="blankRun" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            {blankRuns.map((run) => (
              <SelectItem key={run.id} value={String(run.id)}>
                {run.parameters.sample} · {formatDateTime(run.startedAt)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Note" id="note" className="col-span-2">
        <Textarea id="note" rows={2} value={values.note} onChange={(event) => set("note", event.target.value)} />
      </Field>
    </div>
  )
}
