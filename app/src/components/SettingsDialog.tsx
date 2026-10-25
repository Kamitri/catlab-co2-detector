import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"

import { Field } from "@/components/RunForm"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { api, type Settings } from "@/lib/api"
import { VENDOR_EXPONENT, VENDOR_SCALE } from "@/lib/data"
import { parseNumber } from "@/lib/runForm"

const NUMBER_FIELDS = [
  ["baselineWindowS", "Baseline window (s)"],
  ["coWindowS", <>C<sub>0</sub> window (s)</>],
  ["equilibriumBandPercent", "Equilibrium band (%)"],
  ["equilibriumDurationS", "Equilibrium duration (s)"],
  ["conversionScale", "Conversion scale (ppm)"],
  ["conversionExponent", "Conversion exponent"],
  ["retentionDays", "Data retention (days)"],
] as const

type NumberKey = (typeof NUMBER_FIELDS)[number][0]

export function SettingsDialog({
  settings,
  onCancel,
  onSave,
}: {
  settings: Settings
  onCancel: () => void
  onSave: (settings: Settings) => Promise<void>
}) {
  const [folder, setFolder] = useState(settings.exportFolder)
  const [defaultFolder, setDefaultFolder] = useState("")
  const [pattern, setPattern] = useState(settings.fileNamePattern)
  const [ports, setPorts] = useState(settings.extraPorts.join(", "))
  const [numbers, setNumbers] = useState<Record<NumberKey, string>>(
    () => Object.fromEntries(NUMBER_FIELDS.map(([key]) => [key, String(settings[key])])) as Record<NumberKey, string>,
  )

  useEffect(() => {
    void api.defaultFolder().then(setDefaultFolder)
  }, [])

  const invalid = new Set(
    NUMBER_FIELDS.filter(([key]) => !(parseNumber(numbers[key]) > 0)).map(([key]) => key as string),
  )
  if (!pattern.trim()) invalid.add("pattern")

  async function browse() {
    const selected = await openDialog({ directory: true, defaultPath: folder || defaultFolder })
    if (typeof selected === "string") setFolder(selected)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid.size > 0) return
    const parsed = Object.fromEntries(NUMBER_FIELDS.map(([key]) => [key, parseNumber(numbers[key])])) as Record<
      NumberKey,
      number
    >
    await onSave({
      ...settings,
      ...parsed,
      retentionDays: Math.round(parsed.retentionDays),
      exportFolder: folder.trim(),
      fileNamePattern: pattern.trim(),
      extraPorts: ports
        .split(",")
        .map((port) => port.trim())
        .filter(Boolean),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-xl">
        <form onSubmit={submit} className="grid gap-5">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <Field label="Export folder" id="folder">
              <div className="flex gap-2">
                <Input
                  id="folder"
                  value={folder}
                  placeholder={defaultFolder}
                  onChange={(event) => setFolder(event.target.value)}
                />
                <Button type="button" variant="outline" onClick={() => void browse()}>
                  Browse
                </Button>
              </div>
            </Field>
            <Field label="File name" id="pattern" invalid={invalid.has("pattern")}>
              <Input
                id="pattern"
                value={pattern}
                aria-invalid={invalid.has("pattern")}
                onChange={(event) => setPattern(event.target.value)}
              />
            </Field>
          </div>
          <Separator />
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {NUMBER_FIELDS.map(([key, label]) => (
              <Field key={key} label={label} id={key} invalid={invalid.has(key)}>
                <Input
                  id={key}
                  inputMode="decimal"
                  value={numbers[key]}
                  aria-invalid={invalid.has(key)}
                  onChange={(event) => setNumbers((current) => ({ ...current, [key]: event.target.value }))}
                />
              </Field>
            ))}
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() =>
                  setNumbers((current) => ({
                    ...current,
                    conversionScale: String(VENDOR_SCALE),
                    conversionExponent: String(VENDOR_EXPONENT),
                  }))
                }
              >
                Reset conversion
              </Button>
            </div>
          </div>
          <Separator />
          <Field label="Additional ports" id="ports">
            <Input id="ports" value={ports} onChange={(event) => setPorts(event.target.value)} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" disabled={invalid.size > 0}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
