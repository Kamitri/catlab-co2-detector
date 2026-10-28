import { open as openDialog } from "@tauri-apps/plugin-dialog"
import { useEffect, useState } from "react"

import { FormGrid, FormGroup, FormRow, NumberInput } from "@/components/FormLayout"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { api, type Settings, type Theme } from "@/lib/api"
import { parseNumber } from "@/lib/runForm"
import { DEFAULT_SETTINGS } from "@/lib/settings"

const NUMBER_KEYS = [
  "coWindowS",
  "equilibriumBandPercent",
  "massPrecisionG",
  "soapVolumePrecisionMl",
  "conversionScale",
  "conversionExponent",
  "retentionDays",
] as const

type NumberKey = (typeof NUMBER_KEYS)[number]

function numberTexts(settings: Settings): Record<NumberKey, string> {
  return Object.fromEntries(NUMBER_KEYS.map((key) => [key, String(settings[key])])) as Record<NumberKey, string>
}

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
  const [theme, setTheme] = useState<Theme>(settings.theme)
  const [numbers, setNumbers] = useState(() => numberTexts(settings))

  // Fills form with default values; Save applies them
  function resetToDefaults() {
    setFolder(DEFAULT_SETTINGS.exportFolder)
    setPattern(DEFAULT_SETTINGS.fileNamePattern)
    setPorts(DEFAULT_SETTINGS.extraPorts.join(", "))
    setTheme(DEFAULT_SETTINGS.theme)
    setNumbers(numberTexts(DEFAULT_SETTINGS))
  }

  useEffect(() => {
    void api.defaultFolder().then(setDefaultFolder)
  }, [])

  const invalid = new Set<string>(NUMBER_KEYS.filter((key) => !(parseNumber(numbers[key]) > 0)))
  // Whole days: retention rounded to 0 would delete measurements outside runs at once
  if (!Number.isInteger(parseNumber(numbers.retentionDays))) invalid.add("retentionDays")
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
      exportFolder: folder.trim(),
      fileNamePattern: pattern.trim(),
      theme,
      extraPorts: ports
        .split(",")
        .map((port) => port.trim())
        .filter(Boolean),
    })
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[560px]">
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
                {numberRow("equilibriumBandPercent", "Maximum variation", "%")}
              </FormGrid>
            </FormGroup>
            <FormGroup title="Precision">
              <FormGrid columns={2}>
                {numberRow("massPrecisionG", "Sorbent mass", "g")}
                <div className="col-span-2" />
                {numberRow("soapVolumePrecisionMl", "Soap film volume", "mL")}
              </FormGrid>
            </FormGroup>
            <FormGroup title="Conversion">
              <FormGrid columns={2}>
                {numberRow("conversionScale", "Scale", "ppm")}
                {numberRow("conversionExponent", "Exponent")}
              </FormGrid>
            </FormGroup>
            <FormGroup title="Display">
              <FormGrid columns={2}>
                <FormRow label="Theme" id="theme">
                  <Select value={theme} onValueChange={(value) => setTheme(value as Theme)}>
                    <SelectTrigger id="theme" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
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
            <Button type="button" variant="outline" className="sm:mr-auto" onClick={resetToDefaults}>
              Reset to defaults
            </Button>
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
