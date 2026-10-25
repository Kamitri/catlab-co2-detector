import { useState } from "react"

import { FormGrid, FormRow } from "@/components/FormLayout"
import { RunFields, SoapFilmFields } from "@/components/RunForm"
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
import { formatDateTime } from "@/lib/format"
import { toParameters } from "@/lib/runForm"

/** Sample of next run, configured before Start, or of run in progress. */
export function SampleDialog({
  defaults,
  blankRuns,
  showDelay,
  onCancel,
  onSave,
}: {
  defaults: RunParameters
  blankRuns: Run[]
  showDelay: boolean
  onCancel: () => void
  onSave: (parameters: RunParameters) => Promise<void>
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
      await onSave(toParameters(form.values))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Sample</DialogTitle>
          </DialogHeader>
          <RunFields form={form} blankRuns={blankRuns} showDelay={showDelay} showValidation={submitted} />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function FinishDialog({
  run,
  onCancel,
  onFinish,
}: {
  run: Run
  onCancel: () => void
  onFinish: (parameters: RunParameters) => Promise<void>
}) {
  const form = useRunForm(run.parameters)
  const [busy, setBusy] = useState(false)
  const invalid = [...form.errors].some((key) => key.startsWith("soap"))

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid) return
    setBusy(true)
    try {
      await onFinish(toParameters(form.values))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Finish run</DialogTitle>
          </DialogHeader>
          <SoapFilmFields form={form} showValidation />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || invalid}>
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
