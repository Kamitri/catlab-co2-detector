import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { useRunForm } from "@/hooks/useRunForm"
import type { Run } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import type { NumericKey } from "@/lib/runForm"
import { cn } from "@/lib/utils"

const NUMERIC_FIELDS: [NumericKey, React.ReactNode][] = [
  ["flowRateMlMin", "Flow rate (mL/min)"],
  ["massG", "Sorbent mass (g)"],
  ["densityGMl", "Sorbent density (g/mL)"],
  ["pressureBar", "Pressure (bar)"],
  ["temperatureC", "Temperature (°C)"],
  ["delayS", "Delay time (s)"],
  ["baselineWindowS", "Baseline window (s)"],
  [
    "coWindowS",
    <>
      C<sub>0</sub> window (s)
    </>,
  ],
]

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
