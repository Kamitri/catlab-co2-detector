import { useState } from "react"

import { Field, parseNumber, RunFields, toParameters, useRunForm } from "@/components/RunForm"
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
import type { Run, RunParameters } from "@/lib/api"
import { formatDateTime, formatNumber } from "@/lib/format"

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
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
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
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Finish run</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-5 gap-2">
            {measurements.map((text, index) => (
              <Field key={index} label={`Flow ${index + 1}`} id={`flow-${index}`} invalid={invalid[index]}>
                <Input
                  id={`flow-${index}`}
                  inputMode="decimal"
                  value={text}
                  aria-invalid={invalid[index]}
                  autoFocus={index === 0}
                  onChange={(event) =>
                    setMeasurements((list) => list.map((item, position) => (position === index ? event.target.value : item)))
                  }
                />
              </Field>
            ))}
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">Flow rate (mL/min)</span>
            <span className="tabular-nums">
              {average !== null ? formatNumber(average) : formatNumber(run.parameters.flowRateMlMin)}
            </span>
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
          className="grid gap-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (label.trim()) onAdd(label.trim())
          }}
        >
          <DialogHeader>
            <DialogTitle>Add marker</DialogTitle>
          </DialogHeader>
          <Field label="Label" id="marker-label">
            <Input id="marker-label" value={label} autoFocus onChange={(event) => setLabel(event.target.value)} />
          </Field>
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
