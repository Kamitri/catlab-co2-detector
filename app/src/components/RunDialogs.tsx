import { useState } from "react"

import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { RunFields } from "@/components/RunForm"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useRunForm } from "@/hooks/useRunForm"
import type { Run, RunParameters } from "@/lib/api"
import { formatDateTime, formatNumber } from "@/lib/format"
import { parseNumber, toParameters } from "@/lib/runForm"

export function StartDialog({
  defaults,
  blankRuns,
  onCancel,
  onStart,
}: {
  defaults: RunParameters
  blankRuns: Run[]
  onCancel: () => void
  onStart: (parameters: RunParameters) => Promise<void>
}) {
  const form = useRunForm(defaults)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (form.errors.size > 0) return
    setBusy(true)
    try {
      await onStart(toParameters(form.values, []))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Start run</DialogTitle>
          </DialogHeader>
          <RunFields form={form} blankRuns={blankRuns} showDelay={false} showValidation={submitted} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Start
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

const MEASUREMENT_COUNT = 5

export function FinishDialog({
  run,
  onCancel,
  onFinish,
}: {
  run: Run
  onCancel: () => void
  onFinish: (parameters: RunParameters) => Promise<void>
}) {
  const [measurements, setMeasurements] = useState<string[]>(() =>
    Array.from({ length: MEASUREMENT_COUNT }, (_, index) => {
      const value = run.parameters.flowMeasurements[index]
      return value === undefined ? "" : String(value)
    }),
  )
  const [busy, setBusy] = useState(false)
  const parsed = measurements.map(parseNumber)
  const invalid = measurements.map((text, index) => text.trim() !== "" && !(parsed[index] > 0))
  const values = parsed.filter((value) => Number.isFinite(value) && value > 0)
  const average = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : null

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid.some(Boolean)) return
    setBusy(true)
    try {
      await onFinish({ ...run.parameters, flowMeasurements: values })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Finish run</DialogTitle>
          </DialogHeader>
          <div>
            <FormGroup title="Flow rate">
              <FormGrid>
                {measurements.map((text, index) => (
                  <FormRow key={index} label={`Measurement ${index + 1}`} id={`flow-${index}`} invalid={invalid[index]}>
                    <NumberInput
                      id={`flow-${index}`}
                      value={text}
                      unit="mL/min"
                      invalid={invalid[index]}
                      autoFocus={index === 0}
                      onChange={(value) =>
                        setMeasurements((list) => list.map((item, position) => (position === index ? value : item)))
                      }
                    />
                  </FormRow>
                ))}
                <FormRow label="Mean">
                  <div className="flex h-7 items-center justify-end px-2 font-medium tabular-nums">
                    {average !== null ? formatNumber(average) : formatNumber(run.parameters.flowRateMlMin)}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">mL/min</span>
                  </div>
                </FormRow>
              </FormGrid>
            </FormGroup>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid.some(Boolean)}>
              Finish
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MarkerDialog({ onCancel, onAdd }: { onCancel: () => void; onAdd: (label: string) => void }) {
  const [label, setLabel] = useState("")
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (label.trim()) onAdd(label.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>Add marker</DialogTitle>
          </DialogHeader>
          <FormGrid>
            <FormRow label="Label" id="marker-label">
              <Input
                id="marker-label"
                value={label}
                autoFocus
                autoComplete="off"
                onChange={(event) => setLabel(event.target.value)}
              />
            </FormRow>
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={!label.trim()}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ConfirmDialog({
  title,
  description,
  action,
  destructive = false,
  onCancel,
  onConfirm,
}: {
  title: string
  description?: string
  action: string
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={destructive ? "destructive" : "default"} onClick={onConfirm}>
            {action}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

export function RecoveryDialog({
  run,
  onResume,
  onFinish,
}: {
  run: Run
  onResume: () => void
  onFinish: () => void
}) {
  return (
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Run in progress</AlertDialogTitle>
          <AlertDialogDescription>
            {run.parameters.sample} · {formatDateTime(run.startedAt)}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onFinish}>Finish</AlertDialogCancel>
          <AlertDialogAction onClick={onResume}>Resume</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
