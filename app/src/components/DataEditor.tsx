import { useEffect, useLayoutEffect, useRef, useState } from "react"

import { ConfirmDialog } from "@/components/RunDialogs"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { api, type Run } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { parseNumber } from "@/lib/runForm"
import { cn } from "@/lib/utils"

const ROW_HEIGHT = 28
/** Rows rendered above and below visible rows, for smooth scrolling. */
const OVERSCAN = 10
const UNDO_LIMIT = 100

/** Editable cells of row, as typed text: elapsed time (s) and raw signal N. CO₂ follows from raw signal. */
interface Row {
  time: string
  count: string
}

type Column = 0 | 1
const KEYS: (keyof Row)[] = ["time", "count"]

function validCell(row: Row, column: Column): boolean {
  const number = parseNumber(row[KEYS[column]])
  return Number.isFinite(number) && (column === 0 || number >= 0)
}

function toText(number: number): string {
  return String(number)
}

/** Shown text of cell: time with up to 3 decimals, raw signal with up to 2; editing and copying use full value. */
function display(text: string, column: Column): string {
  const number = parseNumber(text)
  if (!Number.isFinite(number)) return text
  return number.toLocaleString("en-US", { maximumFractionDigits: column === 0 ? 3 : 2, useGrouping: false })
}

/**
 * Spreadsheet of run data. Arrow keys and Tab move cell, typing or Enter edits, Shift extends row selection,
 * Ctrl+C and Ctrl+V copy and paste tab-separated text (Excel), Ctrl+Z and Ctrl+Y undo and redo.
 * Edited data is saved separately from measurements; Restore original removes it.
 */
export function DataEditor({ run, onClose, onSaved }: { run: Run; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [edited, setEdited] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [cursor, setCursor] = useState<{ row: number; column: Column }>({ row: 0, column: 1 })
  const [anchor, setAnchor] = useState(0)
  const [editing, setEditing] = useState<string | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [busy, setBusy] = useState(false)
  const undo = useRef<Row[][]>([])
  const redo = useRef<Row[][]>([])
  const viewport = useRef<HTMLDivElement>(null)
  // Edit is committed once: Enter, Tab or click elsewhere commit, later blur of removed input does not
  const editOpen = useRef(false)
  const loaded = rows !== null

  useEffect(() => {
    void api.getRunData(run.id).then((data) => {
      setRows(data.times.map((time, index) => ({ time: toText(time), count: toText(data.counts[index]) })))
      setEdited(data.edited)
    })
  }, [run.id])

  useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const observer = new ResizeObserver(() => setHeight(element.clientHeight))
    observer.observe(element)
    return () => observer.disconnect()
  }, [loaded])

  // Keeps cursor row in view after keyboard movement
  useEffect(() => {
    const element = viewport.current
    if (!element) return
    const top = cursor.row * ROW_HEIGHT
    if (top < element.scrollTop) element.scrollTop = top
    else if (top + ROW_HEIGHT > element.scrollTop + element.clientHeight) {
      element.scrollTop = top + ROW_HEIGHT - element.clientHeight
    }
  }, [cursor.row])

  if (rows === null) {
    return (
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="sm:max-w-[720px]">
          <DialogHeader>
            <DialogTitle>Data · {run.parameters.sample}</DialogTitle>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }
  const current = rows

  // CO₂ (ppm) of row with conversion of run, as in calculation and export
  const co2Text = (row: Row) => {
    const count = parseNumber(row.count)
    return Number.isFinite(count) ? (run.conversionScale * Math.exp(run.conversionExponent * count)).toFixed(2) : ""
  }

  const first = Math.min(anchor, cursor.row)
  const last = Math.max(anchor, cursor.row)
  const invalid = current.some((row) => !validCell(row, 0) || !validCell(row, 1))

  function change(next: Row[]) {
    undo.current = [...undo.current.slice(-(UNDO_LIMIT - 1)), current]
    redo.current = []
    setRows(next)
    setDirty(true)
  }

  function restoreFrom(from: React.RefObject<Row[][]>, to: React.RefObject<Row[][]>) {
    const previous = from.current.pop()
    if (!previous) return
    to.current.push(current)
    setRows(previous)
    setDirty(true)
    setCursor((position) => ({ ...position, row: Math.min(position.row, previous.length - 1) }))
  }

  function moveTo(row: number, column: Column, extend = false) {
    const target = Math.max(0, Math.min(current.length - 1, row))
    setCursor({ row: target, column })
    if (!extend) setAnchor(target)
  }

  function startEdit(text: string) {
    editOpen.current = true
    setEditing(text)
  }

  function cancelEdit() {
    editOpen.current = false
    setEditing(null)
  }

  function commitEdit(text: string) {
    if (!editOpen.current) return
    editOpen.current = false
    const key = KEYS[cursor.column]
    if (current[cursor.row][key] !== text) {
      change(current.map((row, index) => (index === cursor.row ? { ...row, [key]: text.trim() } : row)))
    }
    setEditing(null)
  }

  function addRow() {
    const index = Math.min(cursor.row, current.length - 1)
    const here = current[index]
    const next = current[index + 1]
    const time = parseNumber(here?.time ?? "0")
    const nextTime = next ? parseNumber(next.time) : Number.NaN
    // New row between selected row and next row, with raw signal of selected row
    const newTime = Number.isFinite(nextTime) ? (time + nextTime) / 2 : time + 1
    const row = { time: toText(Number.isFinite(newTime) ? newTime : 0), count: here?.count ?? "" }
    change([...current.slice(0, index + 1), row, ...current.slice(index + 1)])
    moveTo(index + 1, cursor.column)
  }

  function deleteRows() {
    if (current.length - (last - first + 1) < 1) return
    change([...current.slice(0, first), ...current.slice(last + 1)])
    moveTo(first, cursor.column)
  }

  function paste(text: string) {
    const lines = text.replace(/\r/g, "").split("\n")
    if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop()
    const next = [...current]
    lines.forEach((line, offset) => {
      const cells = line.split(/\t|;|,(?=\s*-?\d)/).map((cell) => cell.trim())
      const index = cursor.row + offset
      const row = { ...(next[index] ?? { time: "", count: "" }) }
      if (cursor.column === 0) {
        row.time = cells[0] ?? row.time
        if (cells.length > 1) row.count = cells[1]
      } else {
        row.count = cells[0] ?? row.count
      }
      next[index] = row
    })
    change(next)
    setAnchor(cursor.row)
    setCursor((position) => ({ ...position, row: Math.min(cursor.row + lines.length - 1, next.length - 1) }))
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (editing !== null) return
    const control = event.ctrlKey || event.metaKey
    const key = event.key
    if (control && (key === "z" || key === "Z")) {
      event.preventDefault()
      if (event.shiftKey) restoreFrom(redo, undo)
      else restoreFrom(undo, redo)
    } else if (control && (key === "y" || key === "Y")) {
      event.preventDefault()
      restoreFrom(redo, undo)
    } else if (control && (key === "a" || key === "A")) {
      event.preventDefault()
      setAnchor(0)
      setCursor((position) => ({ ...position, row: current.length - 1 }))
    } else if (key === "ArrowDown" || key === "ArrowUp") {
      event.preventDefault()
      moveTo(cursor.row + (key === "ArrowDown" ? 1 : -1), cursor.column, event.shiftKey)
    } else if (key === "PageDown" || key === "PageUp") {
      event.preventDefault()
      const page = Math.max(1, Math.floor(height / ROW_HEIGHT) - 1)
      moveTo(cursor.row + (key === "PageDown" ? page : -page), cursor.column, event.shiftKey)
    } else if (key === "ArrowLeft" || key === "ArrowRight") {
      event.preventDefault()
      moveTo(cursor.row, key === "ArrowLeft" ? 0 : 1)
    } else if (key === "Tab") {
      event.preventDefault()
      if (event.shiftKey) {
        if (cursor.column === 1) moveTo(cursor.row, 0)
        else moveTo(cursor.row - 1, 1)
      } else if (cursor.column === 0) moveTo(cursor.row, 1)
      else moveTo(cursor.row + 1, 0)
    } else if (key === "Enter" || key === "F2") {
      event.preventDefault()
      startEdit(current[cursor.row][KEYS[cursor.column]])
    } else if (key === "Delete" || key === "Backspace") {
      event.preventDefault()
      const field = KEYS[cursor.column]
      change(current.map((row, index) => (index >= first && index <= last ? { ...row, [field]: "" } : row)))
    } else if (key.length === 1 && !control && !event.altKey) {
      // Typing replaces cell content, as in spreadsheet
      event.preventDefault()
      startEdit(key)
    }
  }

  function onEditKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    const text = event.currentTarget.value
    if (event.key === "Enter" || event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      commitEdit(text)
      moveTo(cursor.row + (event.key === "ArrowUp" ? -1 : 1), cursor.column)
      viewport.current?.focus()
    } else if (event.key === "Tab") {
      event.preventDefault()
      commitEdit(text)
      if (cursor.column === 0) moveTo(cursor.row, 1)
      else moveTo(cursor.row + 1, 0)
      viewport.current?.focus()
    } else if (event.key === "Escape") {
      event.preventDefault()
      cancelEdit()
      viewport.current?.focus()
    }
  }

  async function save() {
    setBusy(true)
    try {
      await api.saveRunData(
        run.id,
        current.map((row) => parseNumber(row.time)),
        current.map((row) => parseNumber(row.count)),
      )
      onSaved()
    } catch (error) {
      await api.logMessage("error", String(error))
    } finally {
      setBusy(false)
    }
  }

  async function restoreOriginal() {
    setConfirmRestore(false)
    try {
      await api.restoreRunData(run.id)
      onSaved()
    } catch (error) {
      await api.logMessage("error", String(error))
    }
  }

  const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const end = Math.min(current.length, Math.ceil((scrollTop + height) / ROW_HEIGHT) + OVERSCAN)
  const columns = "grid grid-cols-[64px_120px_96px_minmax(0,1fr)_minmax(0,1fr)]"

  const cell = (index: number, column: Column) => {
    const row = current[index]
    const active = cursor.row === index && cursor.column === column
    const bad = !validCell(row, column)
    return (
      <div
        className={cn(
          "flex h-7 items-center justify-end px-2 tabular-nums",
          bad && "bg-destructive/10 text-destructive",
          active && "outline-2 -outline-offset-2 outline-primary",
        )}
        onMouseDown={(event) => {
          event.preventDefault()
          if (editing !== null) commitEdit(editing)
          moveTo(index, column, event.shiftKey)
          viewport.current?.focus()
        }}
        onDoubleClick={() => startEdit(row[KEYS[column]])}
      >
        {active && editing !== null ? (
          <input
            autoFocus
            value={editing}
            inputMode="decimal"
            onChange={(event) => setEditing(event.currentTarget.value)}
            className="h-full w-full bg-background text-right tabular-nums outline-none"
            onKeyDown={onEditKeyDown}
            onBlur={(event) => commitEdit(event.currentTarget.value)}
          />
        ) : (
          display(row[KEYS[column]], column)
        )}
      </div>
    )
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="flex h-[85vh] flex-col sm:max-w-[720px]"
        // Escape cancels cell editing; dialog closes only with Cancel or close button
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Data · {run.parameters.sample}</DialogTitle>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" onClick={addRow}>
            Add row
          </Button>
          <Button type="button" variant="outline" disabled={current.length <= last - first + 1} onClick={deleteRows}>
            {last > first ? `Delete rows (${last - first + 1})` : "Delete row"}
          </Button>
          {edited && (
            <Button type="button" variant="outline" className="ml-auto" onClick={() => setConfirmRestore(true)}>
              Restore original
            </Button>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border">
          <div className={cn(columns, "shrink-0 border-b bg-muted/50 text-xs font-medium text-muted-foreground")}>
            <div className="px-2 py-1.5 text-right">#</div>
            <div className="px-2 py-1.5 text-right">t (s)</div>
            <div className="px-2 py-1.5 text-right">Time</div>
            <div className="px-2 py-1.5 text-right">Raw signal</div>
            <div className="px-2 py-1.5 text-right">
              CO<sub>2</sub> (ppm)
            </div>
          </div>
          <div
            ref={viewport}
            tabIndex={0}
            aria-label="Data"
            className="min-h-0 flex-1 overflow-y-auto outline-none select-none"
            onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
            onKeyDown={onKeyDown}
            onCopy={(event) => {
              if (editing !== null) return
              event.preventDefault()
              const text = current
                .slice(first, last + 1)
                .map((row) => `${row.time}\t${row.count}\t${co2Text(row)}`)
                .join("\n")
              event.clipboardData.setData("text/plain", text)
            }}
            onPaste={(event) => {
              if (editing !== null) return
              event.preventDefault()
              paste(event.clipboardData.getData("text/plain"))
            }}
          >
            <div style={{ height: current.length * ROW_HEIGHT, position: "relative" }}>
              <div style={{ position: "absolute", top: start * ROW_HEIGHT, left: 0, right: 0 }}>
                {current.slice(start, end).map((row, offset) => {
                  const index = start + offset
                  const time = parseNumber(row.time)
                  const selected = index >= first && index <= last
                  return (
                    <div
                      key={index}
                      className={cn(columns, "border-b border-border/50", selected && "bg-primary/10")}
                      data-row={index}
                    >
                      <div className="flex h-7 items-center justify-end px-2 text-muted-foreground tabular-nums">
                        {index + 1}
                      </div>
                      {cell(index, 0)}
                      <div className="flex h-7 items-center justify-end px-2 text-muted-foreground tabular-nums">
                        {Number.isFinite(time) ? formatClock(run.startedAt + time * 1000) : ""}
                      </div>
                      {cell(index, 1)}
                      <div className="flex h-7 items-center justify-end px-2 text-muted-foreground tabular-nums">
                        {co2Text(row)}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={busy || invalid || !dirty} onClick={() => void save()}>
            Save
          </Button>
        </DialogFooter>
        {confirmRestore && (
          <ConfirmDialog
            title="Are you sure?"
            description="This action will delete ALL edits of this data and restore the measured data. This action is irreversible."
            action="Restore original"
            destructive
            onCancel={() => setConfirmRestore(false)}
            onConfirm={() => void restoreOriginal()}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}
