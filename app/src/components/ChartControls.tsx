import { useState } from "react"

import type { DragMode } from "@/components/Chart"
import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { parseNumber } from "@/lib/runForm"
import type { View } from "@/lib/view"

/** Number as field text, without floating point noise from zoom (for example 4999.999999 → 5000). */
function fieldText(value: number): string {
  return String(Number(value.toPrecision(6)))
}

interface AxesFormProps {
  view: View
  yLabel: React.ReactNode
  yUnit?: string
  onApply: (view: View) => void
}

function AxesForm({ view, yLabel, yUnit, onApply }: AxesFormProps) {
  const [fields, setFields] = useState(() => ({
    xFrom: fieldText(view.x[0]),
    xTo: fieldText(view.x[1]),
    yFrom: fieldText(view.y[0]),
    yTo: fieldText(view.y[1]),
  }))
  const values = {
    xFrom: parseNumber(fields.xFrom),
    xTo: parseNumber(fields.xTo),
    yFrom: parseNumber(fields.yFrom),
    yTo: parseNumber(fields.yTo),
  }
  const invalidX = !(Number.isFinite(values.xFrom) && Number.isFinite(values.xTo) && values.xFrom < values.xTo)
  const invalidY = !(Number.isFinite(values.yFrom) && Number.isFinite(values.yTo) && values.yFrom < values.yTo)

  const field = (key: keyof typeof fields, invalid: boolean, unit?: string) => (
    <NumberInput
      id={`axes-${key}`}
      value={fields[key]}
      unit={unit}
      invalid={invalid}
      onChange={(value) => setFields((current) => ({ ...current, [key]: value }))}
    />
  )

  return (
    <form
      className="grid gap-3"
      onSubmit={(event) => {
        event.preventDefault()
        if (invalidX || invalidY) return
        onApply({ x: [values.xFrom, values.xTo], y: [values.yFrom, values.yTo] })
      }}
    >
      <FormGroup title="Time">
        <FormGrid compact>
          <FormRow label="From" id="axes-xFrom" invalid={invalidX}>
            {field("xFrom", invalidX, "s")}
          </FormRow>
          <FormRow label="To" id="axes-xTo" invalid={invalidX}>
            {field("xTo", invalidX, "s")}
          </FormRow>
        </FormGrid>
      </FormGroup>
      <FormGroup title={yLabel}>
        <FormGrid compact>
          <FormRow label="From" id="axes-yFrom" invalid={invalidY}>
            {field("yFrom", invalidY, yUnit)}
          </FormRow>
          <FormRow label="To" id="axes-yTo" invalid={invalidY}>
            {field("yTo", invalidY, yUnit)}
          </FormRow>
        </FormGrid>
      </FormGroup>
      <div className="flex justify-end">
        <Button type="submit" disabled={invalidX || invalidY}>
          Apply
        </Button>
      </div>
    </form>
  )
}

interface ChartControlsProps {
  dragMode: DragMode
  onDragModeChange: (mode: DragMode) => void
  view: View
  onViewChange: (view: View) => void
  onReset: () => void
  yLabel: React.ReactNode
  yUnit?: string
}

export function ChartControls({ dragMode, onDragModeChange, view, onViewChange, onReset, yLabel, yUnit }: ChartControlsProps) {
  const [axesOpen, setAxesOpen] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <div className="flex rounded-lg border p-0.5">
        {(["zoom", "pan"] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={dragMode === mode ? "secondary" : "ghost"}
            className="px-2.5"
            onClick={() => onDragModeChange(mode)}
          >
            {mode === "zoom" ? "Zoom" : "Pan"}
          </Button>
        ))}
      </div>
      <Popover open={axesOpen} onOpenChange={setAxesOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline">Axes</Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64">
          {/* Form is created when popover opens, so fields start at current view */}
          <AxesForm
            view={view}
            yLabel={yLabel}
            yUnit={yUnit}
            onApply={(next) => {
              onViewChange(next)
              setAxesOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <Button variant="outline" onClick={onReset}>
        Reset view
      </Button>
    </div>
  )
}
