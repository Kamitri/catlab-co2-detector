import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { useRunForm } from "@/hooks/useRunForm"
import type { Run } from "@/lib/api"
import { formatDateTime } from "@/lib/format"
import type { NumericKey } from "@/lib/runForm"

interface NumberField {
  key: NumericKey
  label: React.ReactNode
  unit: string
}

const SORBENT_FIELDS: NumberField[] = [
  { key: "massG", label: "Mass", unit: "g" },
  { key: "densityGMl", label: "Density", unit: "g/mL" },
]

const GAS_FIELDS: NumberField[] = [
  { key: "flowRateMlMin", label: "Flow rate", unit: "mL/min" },
  { key: "pressureBar", label: "Pressure", unit: "bar" },
  { key: "temperatureC", label: "Temperature", unit: "°C" },
]

const CALCULATION_FIELDS: NumberField[] = [
  { key: "baselineWindowS", label: "Baseline window", unit: "s" },
  {
    key: "coWindowS",
    label: (
      <>
        C<sub>0</sub> window
      </>
    ),
    unit: "s",
  },
  { key: "delayS", label: "Delay time", unit: "s" },
]

interface RunFieldsProps {
  form: ReturnType<typeof useRunForm>
  blankRuns: Run[]
  showDelay: boolean
  showValidation: boolean
  /** Two columns in dialogs; one column in narrow History panel. */
  columns?: 1 | 2
}

export function RunFields({ form, blankRuns, showDelay, showValidation, columns = 2 }: RunFieldsProps) {
  const { values, set, errors } = form
  const invalid = (key: string) => showValidation && errors.has(key)

  const numberRows = (fields: NumberField[]) =>
    fields
      .filter((field) => showDelay || field.key !== "delayS")
      .map((field) => (
        <FormRow key={field.key} label={field.label} id={field.key} invalid={invalid(field.key)}>
          <NumberInput
            id={field.key}
            value={values[field.key]}
            unit={field.unit}
            invalid={invalid(field.key)}
            onChange={(value) => set(field.key, value)}
          />
        </FormRow>
      ))

  return (
    <div className="grid gap-3">
      <FormGroup title="Sample">
        <FormGrid columns={columns}>
          <FormRow label="Sample" id="sample" invalid={invalid("sample")} wide>
            <Input
              id="sample"
              value={values.sample}
              aria-invalid={invalid("sample")}
              autoFocus
              autoComplete="off"
              onChange={(event) => set("sample", event.target.value)}
            />
          </FormRow>
          <FormRow label="Operator" id="operator" wide>
            <Input
              id="operator"
              value={values.operator}
              autoComplete="off"
              onChange={(event) => set("operator", event.target.value)}
            />
          </FormRow>
        </FormGrid>
      </FormGroup>
      <FormGroup title="Sorbent">
        <FormGrid columns={columns}>{numberRows(SORBENT_FIELDS)}</FormGrid>
      </FormGroup>
      <FormGroup title="Gas">
        <FormGrid columns={columns}>{numberRows(GAS_FIELDS)}</FormGrid>
      </FormGroup>
      <FormGroup title="Calculation">
        <FormGrid columns={columns}>
          {numberRows(CALCULATION_FIELDS)}
          <FormRow label="Blank run" id="blankRun" wide>
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
          </FormRow>
        </FormGrid>
      </FormGroup>
      <FormGroup title="Note">
        <Textarea
          id="note"
          aria-label="Note"
          rows={2}
          value={values.note}
          onChange={(event) => set("note", event.target.value)}
        />
      </FormGroup>
    </div>
  )
}
