import { X } from "lucide-react"

import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import type { useRunForm } from "@/hooks/useRunForm"
import type { Run } from "@/lib/api"
import { formatDateTime, formatNumber } from "@/lib/format"
import { usePrecision } from "@/hooks/usePrecision"
import { parseNumber, soapFlowRate, soapFlowRates, soapTimeKey, type NumericKey } from "@/lib/runForm"

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
  { key: "pressureBar", label: "Pressure", unit: "bar" },
  { key: "temperatureC", label: "Temperature", unit: "°C" },
]

const CALCULATION_FIELDS: NumberField[] = [
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

type RunForm = ReturnType<typeof useRunForm>

/**
 * Flow rate: soap film flowmeter times over volume, from which flow rate is calculated, or flow rate entered
 * directly (entry in Settings).
 */
export function SoapFilmFields({
  form,
  showValidation,
  columns = 1,
}: {
  form: RunForm
  showValidation: boolean
  /** Columns of surrounding form; rows span full width to keep label column aligned. */
  columns?: 1 | 2
}) {
  const { values, set, errors } = form
  const decimals = usePrecision()
  const volume = parseNumber(values.soapVolumeMl)
  const rates = soapFlowRates(values)
  const mean = rates.length > 0 ? rates.reduce((sum, rate) => sum + rate, 0) / rates.length : null
  const setTime = (index: number, text: string) =>
    set(
      "soapTimesS",
      values.soapTimesS.map((item, position) => (position === index ? text : item)),
    )

  if (values.flowEntry === "flowRate") {
    const invalid = showValidation && errors.has("flowRateMlMin")
    return (
      <FormGroup title="Flow rate">
        <FormGrid columns={columns}>
          <FormRow label="Flow rate" id="flowRateMlMin" invalid={invalid} wide>
            <div className="w-35">
              <NumberInput
                id="flowRateMlMin"
                value={values.flowRateMlMin}
                unit="mL/min"
                invalid={invalid}
                onChange={(value) => set("flowRateMlMin", value)}
              />
            </div>
          </FormRow>
        </FormGrid>
      </FormGroup>
    )
  }

  return (
    <FormGroup
      title="Flow rate"
      action={
        // Empties all times and keeps rows; X deletes one row
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className="text-xs"
          disabled={values.soapTimesS.every((text) => text.trim() === "")}
          onClick={() =>
            set(
              "soapTimesS",
              values.soapTimesS.map(() => ""),
            )
          }
        >
          Clear
        </Button>
      }
    >
      <FormGrid columns={columns}>
        <FormRow label="Volume" id="soapVolumeMl" invalid={showValidation && errors.has("soapVolumeMl")} wide>
          <div className="w-35">
            <NumberInput
              id="soapVolumeMl"
              value={values.soapVolumeMl}
              unit="mL"
              invalid={showValidation && errors.has("soapVolumeMl")}
              decimals={decimals.soapVolumeMl}
              onChange={(value) => set("soapVolumeMl", value)}
            />
          </div>
        </FormRow>
        {values.soapTimesS.map((text, index) => {
          const key = soapTimeKey(index)
          const invalid = errors.has(key)
          const time = parseNumber(text)
          return (
            <FormRow key={key} label={`Time ${index + 1}`} id={key} invalid={invalid} wide>
              <div className="flex items-center gap-3">
                <div className="w-35">
                  <NumberInput
                    id={key}
                    value={text}
                    unit="s"
                    invalid={invalid}
                    decimals={decimals.soapTimeS}
                    onChange={(value) => setTime(index, value)}
                  />
                </div>
                <span className="w-24 whitespace-nowrap text-muted-foreground tabular-nums">
                  {time > 0 && volume > 0 ? `${formatNumber(soapFlowRate(volume, time))} mL/min` : ""}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`Delete time ${index + 1}`}
                  // Tab goes from time to next time, not to delete button
                  tabIndex={-1}
                  className="text-muted-foreground"
                  disabled={values.soapTimesS.length === 1}
                  onClick={() =>
                    set(
                      "soapTimesS",
                      values.soapTimesS.filter((_, position) => position !== index),
                    )
                  }
                >
                  <X />
                </Button>
              </div>
            </FormRow>
          )
        })}
        <FormRow wide>
          <Button type="button" variant="outline" className="w-35" onClick={() => set("soapTimesS", [...values.soapTimesS, ""])}>
            Add
          </Button>
        </FormRow>
        <FormRow label="Flow rate" wide>
          <div className="flex h-7 w-35 items-center justify-end px-2 font-medium tabular-nums">
            {mean !== null ? formatNumber(mean) : "–"}
            <span className="ml-1.5 text-xs font-normal text-muted-foreground">mL/min</span>
          </div>
        </FormRow>
      </FormGrid>
    </FormGroup>
  )
}

interface RunFieldsProps {
  form: RunForm
  blankRuns: Run[]
  showDelay: boolean
  showValidation: boolean
  /** Two columns in dialogs; one column in narrow History panel. */
  columns?: 1 | 2
}

export function RunFields({ form, blankRuns, showDelay, showValidation, columns = 2 }: RunFieldsProps) {
  const { values, set, errors } = form
  const decimals = usePrecision()
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
            decimals={decimals[field.key]}
            onChange={(value) => set(field.key, value)}
          />
        </FormRow>
      ))

  const calculationRows = numberRows(CALCULATION_FIELDS)

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
      <SoapFilmFields form={form} showValidation={showValidation} columns={columns} />
      <FormGroup title="Calculation">
        <FormGrid columns={columns}>
          {calculationRows}
          {/* Empty cells complete row of two columns, so Blank run starts on new row */}
          {columns === 2 && calculationRows.length % 2 === 1 && <div className="col-span-2" />}
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
