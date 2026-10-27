import { save } from "@tauri-apps/plugin-dialog"
import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { GripVertical } from "lucide-react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { Chart, type ChartTrace, type DragMode } from "@/components/Chart"
import { ChartControls } from "@/components/ChartControls"
import { DataEditor } from "@/components/DataEditor"
import { ConfirmDialog } from "@/components/RunDialogs"
import { RunFields } from "@/components/RunForm"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { useChartView } from "@/hooks/useChartView"
import { useRunForm } from "@/hooks/useRunForm"
import { api, type Marker, type Run, type RunResult } from "@/lib/api"
import { GAP_THRESHOLD_MS, type Series, withGaps } from "@/lib/data"
import { formatDateTime, formatDuration, formatInteger, formatNumber } from "@/lib/format"
import { toParameters } from "@/lib/runForm"
import { useDarkMode } from "@/hooks/useTheme"
import { chartPalette } from "@/lib/theme"
import { DEFAULT_CO2_RANGE, DEFAULT_RATIO_RANGE, defaultView } from "@/lib/view"
import { cn } from "@/lib/utils"

const STATUS_LABELS = { running: "Running", finished: "Finished", aborted: "Aborted" }

/** Chart data of run: elapsed time (s) and CO₂ (ppm), from edited data when saved. */
interface ChartData {
  series: Series
  markers: Marker[]
}

function ResultTable({ result }: { result: RunResult }) {
  const rows: [React.ReactNode, string][] = [
    ["# data points", formatInteger(result.sampleCount)],
    ["Missing data", `${formatInteger(result.missingTimeS)} s`],
    ["Flow rate", `${formatNumber(result.flowRateMlMin)} mL/min`],
    ["Baseline", `${formatInteger(result.baselinePpm)} ppm`],
    [<>C<sub>0</sub></>, `${formatInteger(result.coPpm)} ppm`],
    [<>T<sub>b</sub></>, formatDuration(result.tbS)],
    [<>Breakthrough (C/C<sub>0</sub> = 0.05)</>, formatDuration(result.breakthroughTimeS)],
    ["Stoichiometric time", `${formatNumber(result.stoichiometricTimeS, 1)} s`],
    ["Blank time", `${formatNumber(result.blankTimeS, 1)} s`],
    ["GHSV", `${formatInteger(result.ghsvPerH)} 1/h`],
    [<>CO<sub>2</sub> adsorbed</>, `${formatNumber(result.adsorbedVolumeL === null ? null : result.adsorbedVolumeL * 1000, 3)} mL`],
    ["Capacity", `${formatNumber(result.capacityMgG)} mg/g (${formatNumber(result.capacityMmolG, 3)} mmol/g)`],
  ]
  return (
    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
      {rows.map(([label, value], index) => (
        <div key={index} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function RunDetail({
  run,
  runs,
  result,
  onSaved,
  onDeleted,
}: {
  run: Run
  runs: Run[]
  result: RunResult | undefined
  onSaved: () => void
  onDeleted: () => void
}) {
  const form = useRunForm(run.parameters)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [editData, setEditData] = useState(false)
  const [busy, setBusy] = useState(false)
  const blankRuns = runs.filter((candidate) => candidate.id !== run.id && candidate.status !== "running")
  const dirty = JSON.stringify(toParameters(form.values)) !== JSON.stringify(run.parameters)

  async function save() {
    if (form.errors.size > 0) return
    await api.updateRun(run.id, toParameters(form.values))
    onSaved()
  }

  async function exportRun() {
    setBusy(true)
    try {
      await api.exportRun(run.id)
      onSaved()
    } finally {
      setBusy(false)
    }
  }

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <RunFields form={form} blankRuns={blankRuns} showDelay showValidation columns={1} />
        <div className="flex flex-wrap gap-2">
          <Button disabled={!dirty || form.errors.size > 0} onClick={() => void save()}>
            Save
          </Button>
          <Button variant="outline" disabled={busy || run.status === "running"} onClick={() => void exportRun()}>
            Export
          </Button>
          {run.exportPath && (
            <Button variant="outline" onClick={() => void revealItemInDir(run.exportPath!)}>
              Show in folder
            </Button>
          )}
          <Button variant="outline" disabled={run.status === "running"} onClick={() => setEditData(true)}>
            Edit data
          </Button>
          <Button
            variant="destructive"
            className="ml-auto"
            disabled={run.status === "running"}
            onClick={() => setConfirmDelete(true)}
          >
            Delete
          </Button>
        </div>
        <Separator />
        {result && <ResultTable result={result} />}
      </div>
      {editData && (
        <DataEditor
          run={run}
          onClose={() => setEditData(false)}
          onSaved={() => {
            setEditData(false)
            onSaved()
          }}
        />
      )}
      {confirmDelete && (
        <ConfirmDialog
          title="Delete run?"
          description={`${run.parameters.sample} · ${formatDateTime(run.startedAt)}`}
          action="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            setConfirmDelete(false)
            try {
              await api.deleteRun(run.id)
              onDeleted()
            } catch (error) {
              await api.logMessage("error", String(error))
            }
          }}
        />
      )}
    </ScrollArea>
  )
}

export function HistoryView({ refreshKey }: { refreshKey: unknown }) {
  const [runs, setRuns] = useState<Run[]>([])
  const [results, setResults] = useState<Record<number, RunResult>>({})
  const [data, setData] = useState<Record<number, ChartData>>({})
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [focused, setFocused] = useState<number | null>(null)
  const [dragMode, setDragMode] = useState<DragMode>("zoom")
  // Row dragged by grip, and row index where it lands (index equal to row count is below last row)
  const [moving, setMovingState] = useState<{ id: number; target: number } | null>(null)
  // Handlers use ref: mouse events can arrive before render with new state
  const movingRef = useRef<{ id: number; target: number } | null>(null)
  const setMoving = (value: { id: number; target: number } | null) => {
    movingRef.current = value
    setMovingState(value)
  }
  const tableBody = useRef<HTMLTableSectionElement>(null)

  const load = useCallback(async () => {
    const list = await api.listRuns()
    setRuns(list)
    const entries = await Promise.all(list.map(async (run) => [run.id, await api.getRunResult(run.id)] as const))
    setResults(Object.fromEntries(entries))
    setData({})
  }, [])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const shown = useMemo(() => {
    const ids = checked.size > 0 ? [...checked] : focused !== null ? [focused] : []
    return runs.filter((run) => ids.includes(run.id))
  }, [checked, focused, runs])

  useEffect(() => {
    const missing = shown.filter((run) => !data[run.id])
    if (missing.length === 0) return
    void Promise.all(
      missing.map(async (run) => {
        const runData = await api.getRunData(run.id)
        return [run.id, { series: { x: runData.times, y: runData.values }, markers: await api.getMarkers(run.id) }] as const
      }),
    ).then((entries) => setData((current) => ({ ...current, ...Object.fromEntries(entries) })))
  }, [shown, data])

  const overlay = shown.length > 1
  const palette = chartPalette(useDarkMode())
  const traces: ChartTrace[] = useMemo(
    () =>
      shown
        .filter((run) => data[run.id])
        .map((run, index) => {
          const series = data[run.id].series
          const result = results[run.id]
          if (!overlay) {
            return {
              name: run.parameters.sample,
              color: palette.series[0],
              hovertemplate: "%{y:,.0f} ppm<extra></extra>",
              ...withGaps(series.x, series.y, GAP_THRESHOLD_MS / 1000),
            }
          }
          const baseline = result?.baselinePpm ?? 0
          const inlet = result?.coPpm ?? 1
          const afterDelay = series.x.map((seconds) => seconds - run.parameters.delayS)
          const ratio = series.y.map((value) => (value - baseline) / inlet)
          return {
            name: run.parameters.sample,
            color: palette.series[index % palette.series.length],
            hovertemplate: "%{y:.3f}<extra>%{fullData.name}</extra>",
            ...withGaps(afterDelay, ratio, GAP_THRESHOLD_MS / 1000),
          }
        }),
    [shown, data, results, overlay, palette],
  )

  // Shown runs and their loaded data identify chart data; count of traces alone repeats between runs
  const dataRevision = `${shown.map((run) => `${run.id}:${data[run.id] ? 1 : 0}`).join(",")}|${overlay}`

  const lastTime = Math.max(
    0,
    ...traces.map((trace) => {
      const times = trace.x.filter((value): value is number => value !== null)
      return times.length > 0 ? times[times.length - 1] : 0
    }),
  )
  const chartView = useChartView(
    defaultView(lastTime, overlay ? DEFAULT_RATIO_RANGE : DEFAULT_CO2_RANGE),
    shown.map((run) => run.id).join(","),
  )

  const focusedRun = runs.find((run) => run.id === focused) ?? null
  const markers =
    !overlay && shown[0] && data[shown[0].id]
      ? data[shown[0].id].markers.map((marker) => ({
          x: (marker.timestamp - shown[0].startedAt) / 1000,
          label: marker.label,
        }))
      : []

  /** Row index where dragged row lands: before first row with center below pointer. */
  function landingIndex(clientY: number): number {
    const rows = [...(tableBody.current?.querySelectorAll("tr[data-run-id]") ?? [])]
    const index = rows.findIndex((row) => {
      const box = row.getBoundingClientRect()
      return clientY < box.top + box.height / 2
    })
    return index < 0 ? rows.length : index
  }

  // Mouse events on window follow drag outside grip; WebKit WebDriver sends mouse events but not pointer events
  function startMove(id: number, index: number) {
    setMoving({ id, target: index })
    const move = (event: MouseEvent) => {
      const current = movingRef.current
      if (current) setMoving({ id: current.id, target: landingIndex(event.clientY) })
    }
    const up = () => {
      window.removeEventListener("mousemove", move)
      window.removeEventListener("mouseup", up)
      finishMove()
    }
    window.addEventListener("mousemove", move)
    window.addEventListener("mouseup", up)
  }

  function finishMove() {
    const current = movingRef.current
    if (!current) return
    const from = runs.findIndex((run) => run.id === current.id)
    setMoving(null)
    const to = current.target > from ? current.target - 1 : current.target
    if (from < 0 || to === from) return
    const next = [...runs]
    const [run] = next.splice(from, 1)
    next.splice(to, 0, run)
    setRuns(next)
    void api.reorderRuns(next.map((item) => item.id)).catch((error) => api.logMessage("error", String(error)))
  }

  // Newest first: blank run is deleted after runs that use it
  async function deleteChecked() {
    const selected = runs.filter((run) => checked.has(run.id)).sort((first, second) => second.startedAt - first.startedAt)
    for (const run of selected) {
      try {
        await api.deleteRun(run.id)
      } catch (error) {
        await api.logMessage("error", String(error))
      }
    }
    setChecked(new Set())
    setFocused(null)
    await load()
  }

  // Checked runs to one workbook, oldest first
  async function exportChecked() {
    const selected = runs.filter((run) => checked.has(run.id)).sort((first, second) => first.startedAt - second.startedAt)
    const date = new Date().toLocaleDateString("en-CA")
    const name = `${date}_${selected.map((run) => run.parameters.sample).join("_")}`.replace(/[\\/:*?"<>|]/g, "_").slice(0, 120)
    try {
      const folder = await api.exportFolder()
      const path = await save({ defaultPath: `${folder}/${name}.xlsx`, filters: [{ name: "Excel", extensions: ["xlsx"] }] })
      if (path) await api.exportRuns(selected.map((run) => run.id), path)
    } catch (error) {
      await api.logMessage("error", String(error))
    }
  }

  function toggle(id: number) {
    setChecked((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="max-h-[38%] min-h-32 shrink-0 overflow-auto border-b">
        <Table>
          <TableHeader className="sticky top-0 bg-sidebar">
            <TableRow>
              <TableHead className="w-6" />
              <TableHead className="w-10" />
              <TableHead>Start</TableHead>
              <TableHead>Sample</TableHead>
              <TableHead>Operator</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead className="text-right">Capacity (mg/g)</TableHead>
              <TableHead className="text-right">Capacity (mmol/g)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody ref={tableBody}>
            {runs.map((run, index) => (
              <TableRow
                key={run.id}
                data-run-id={run.id}
                data-state={focused === run.id ? "selected" : undefined}
                className={cn(
                  "cursor-default",
                  moving?.id === run.id && "opacity-50",
                  moving?.target === index && "shadow-[inset_0_2px_0_var(--primary)]",
                  moving?.target === runs.length && index === runs.length - 1 && "shadow-[inset_0_-2px_0_var(--primary)]",
                )}
                onClick={() => setFocused(run.id)}
              >
                <TableCell
                  aria-label="Move"
                  className="cursor-grab pr-0 text-muted-foreground"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => {
                    if (event.button !== 0) return
                    event.preventDefault()
                    startMove(run.id, index)
                  }}
                >
                  <GripVertical className="size-3.5" />
                </TableCell>
                <TableCell onClick={(event) => event.stopPropagation()}>
                  <Checkbox checked={checked.has(run.id)} onCheckedChange={() => toggle(run.id)} />
                </TableCell>
                <TableCell className="tabular-nums">{formatDateTime(run.startedAt)}</TableCell>
                <TableCell className="font-medium">{run.parameters.sample}</TableCell>
                <TableCell>{run.parameters.operator}</TableCell>
                <TableCell>
                  <Badge variant={run.status === "aborted" ? "destructive" : run.status === "running" ? "default" : "secondary"}>
                    {STATUS_LABELS[run.status]}
                  </Badge>
                  {run.edited && (
                    <Badge variant="outline" className="ml-1.5">
                      Edited
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatDuration(((run.finishedAt ?? Date.now()) - run.startedAt) / 1000)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(results[run.id]?.capacityMgG)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(results[run.id]?.capacityMmolG, 3)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-4 py-2.5">
            <Button
              variant="outline"
              disabled={checked.size === 0 || runs.some((run) => checked.has(run.id) && run.status === "running")}
              onClick={() => void exportChecked()}
            >
              Export
            </Button>
            <Button
              variant="destructive"
              className="mr-auto"
              disabled={checked.size === 0 || runs.some((run) => checked.has(run.id) && run.status === "running")}
              onClick={() => setConfirmDelete(true)}
            >
              Delete
            </Button>
            <ChartControls
              dragMode={dragMode}
              onDragModeChange={setDragMode}
              view={chartView.view}
              onViewChange={chartView.setView}
              onReset={chartView.reset}
              yLabel={
                overlay ? (
                  <>
                    C/C<sub>0</sub>
                  </>
                ) : (
                  <>
                    CO<sub>2</sub>
                  </>
                )
              }
              yUnit={overlay ? undefined : "ppm"}
            />
          </div>
          <div className="min-h-0 flex-1 p-2">
            <Chart
              traces={traces}
              xTitle={overlay ? "Time after delay (s)" : "Time (s)"}
              yTitle={overlay ? "C/C<sub>0</sub>" : "CO<sub>2</sub> (ppm)"}
              markers={markers}
              revision={dataRevision}
              view={chartView.view}
              onViewChange={chartView.setView}
              dragMode={dragMode}
              showLegend={overlay}
              clockStart={overlay ? undefined : shown[0]?.startedAt}
            />
          </div>
        </div>
        {focusedRun && !overlay && (
          <div className={cn("w-[420px] shrink-0 border-l")}>
            <RunDetail
              key={`${focusedRun.id}-${JSON.stringify(focusedRun.parameters)}`}
              run={focusedRun}
              runs={runs}
              result={results[focusedRun.id]}
              onSaved={() => void load()}
              onDeleted={() => {
                setFocused(null)
                setChecked((current) => {
                  const next = new Set(current)
                  next.delete(focusedRun.id)
                  return next
                })
                void load()
              }}
            />
          </div>
        )}
      </div>
      {confirmDelete && (
        <ConfirmDialog
          title="Are you sure?"
          description={`This action will delete ${runs
            .filter((run) => checked.has(run.id))
            .map((run) => run.parameters.sample)
            .join(", ")}. This action is irreversible.`}
          action="Delete"
          destructive
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => {
            setConfirmDelete(false)
            void deleteChecked()
          }}
        />
      )}
    </div>
  )
}
