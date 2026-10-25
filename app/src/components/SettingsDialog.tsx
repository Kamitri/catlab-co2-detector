import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"

import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { api, type Settings } from "@/lib/api"
import { VENDOR_EXPONENT, VENDOR_SCALE } from "@/lib/data"
import { parseNumber } from "@/lib/runForm"

const NUMBER_KEYS = [
  "baselineWindowS",
  "coWindowS",
  "equilibriumBandPercent",
  "equilibriumDurationS",
  "conversionScale",
  "conversionExponent",
  "retentionDays",
] as const

type NumberKey = (typeof NUMBER_KEYS)[number]

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
    () => Object.fromEntries(NUMBER_KEYS.map((key) => [key, String(settings[key])])) as Record<NumberKey, string>,
  )

  useEffect(() => {
    void api.defaultFolder().then(setDefaultFolder)
  }, [])

  const invalid = new Set<string>(NUMBER_KEYS.filter((key) => !(parseNumber(numbers[key]) > 0)))
  if (!pattern.trim()) invalid.add("pattern")

  const numberRow = (key: NumberKey, label: React.ReactNode, unit?: string) => (
    <FormRow key={key} label={label} id={key} invalid={invalid.has(key)}>
      <NumberInput
        id={key}
        value={numbers[key]}
        unit={unit}
        invalid={invalid.has(key)}
        onChange={(value) => setNumbers((current) => ({ ...current, [key]: value }))}
      />
    </FormRow>
  )

  async function browse() {
    const selected = await openDialog({ directory: true, defaultPath: folder || defaultFolder })
    if (typeof selected === "string") setFolder(selected)
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (invalid.size > 0) return
    const parsed = Object.fromEntries(NUMBER_KEYS.map((key) => [key, parseNumber(numbers[key])])) as Record<
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
      <DialogContent className="sm:max-w-[560px]">
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <FormGroup title="Export">
              <FormGrid columns={2}>
                <FormRow label="Folder" id="folder" wide>
                  <div className="flex gap-2">
                    <Input
                      id="folder"
                      value={folder}
                      placeholder={defaultFolder}
                      autoComplete="off"
                      onChange={(event) => setFolder(event.target.value)}
                    />
                    <Button type="button" variant="outline" onClick={() => void browse()}>
                      Browse
                    </Button>
                  </div>
                </FormRow>
                <FormRow label="File name" id="pattern" invalid={invalid.has("pattern")} wide>
                  <Input
                    id="pattern"
                    value={pattern}
                    aria-invalid={invalid.has("pattern")}
                    autoComplete="off"
                    onChange={(event) => setPattern(event.target.value)}
                  />
                </FormRow>
              </FormGrid>
            </FormGroup>
            <FormGroup title="Calculation">
              <FormGrid columns={2}>
                {numberRow("baselineWindowS", "Baseline window", "s")}
                {numberRow(
                  "coWindowS",
                  <>
                    C<sub>0</sub> window
                  </>,
                  "s",
                )}
              </FormGrid>
            </FormGroup>
            <FormGroup title="Equilibrium">
              <FormGrid columns={2}>
                {numberRow("equilibriumBandPercent", "Band", "%")}
                {numberRow("equilibriumDurationS", "Duration", "s")}
              </FormGrid>
            </FormGroup>
            <FormGroup title="Conversion">
              <FormGrid columns={2}>
                {numberRow("conversionScale", "Scale", "ppm")}
                {numberRow("conversionExponent", "Exponent")}
                <FormRow wide>
                  <Button
                    type="button"
                    variant="outline"
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
                </FormRow>
              </FormGrid>
            </FormGroup>
            <FormGroup title="Data">
              <FormGrid columns={2}>
                {numberRow("retentionDays", "Retention", "days")}
                <div className="col-span-2" />
                <FormRow label="Additional ports" id="ports" wide>
                  <Input id="ports" value={ports} autoComplete="off" onChange={(event) => setPorts(event.target.value)} />
                </FormRow>
              </FormGrid>
            </FormGroup>
          </div>
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
