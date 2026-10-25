import { createContext, useContext } from "react"

import { Label } from "@/components/ui/label"
import { FIELD_WRAPPER_CLASS } from "@/lib/fieldStyle"
import { parseNumber } from "@/lib/runForm"
import { stepValue } from "@/lib/step"
import { cn } from "@/lib/utils"

type Columns = 1 | 2

const ColumnsContext = createContext<Columns>(1)

/** Section of form with small uppercase title; sections after first have top border. */
export function FormGroup({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t pt-3 first:border-t-0 first:pt-0">
      <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

/** Grid of label and field pairs; two columns place two pairs per row. */
export function FormGrid({
  columns = 1,
  compact = false,
  children,
}: {
  columns?: Columns
  /** Narrow label column, for popovers. */
  compact?: boolean
  children: React.ReactNode
}) {
  return (
    <ColumnsContext.Provider value={columns}>
      <div
        className={cn(
          "grid items-center gap-x-3 gap-y-1.5",
          columns === 2
            ? "grid-cols-[128px_minmax(0,1fr)_84px_minmax(0,1fr)]"
            : compact
              ? "grid-cols-[48px_minmax(0,1fr)]"
              : "grid-cols-[128px_minmax(0,1fr)]",
        )}
      >
        {children}
      </div>
    </ColumnsContext.Provider>
  )
}

interface FormRowProps {
  label?: React.ReactNode
  id?: string
  invalid?: boolean
  /** Spans full width of two-column grid. */
  wide?: boolean
  children: React.ReactNode
}

export function FormRow({ label, id, invalid, wide, children }: FormRowProps) {
  const columns = useContext(ColumnsContext)
  return (
    <>
      <Label htmlFor={id} className={cn("font-normal text-muted-foreground", invalid && "text-destructive")}>
        {/* Line height above leading-none of Label keeps descenders, e.g. "p", inside truncated span */}
        <span className="truncate leading-5">{label}</span>
      </Label>
      <div className={cn("min-w-0", wide && columns === 2 && "col-span-3")}>{children}</div>
    </>
  )
}

interface NumberInputProps {
  id: string
  value: string
  unit?: React.ReactNode
  invalid?: boolean
  autoFocus?: boolean
  /** Fixed decimal places; value is formatted when field loses focus. */
  decimals?: number
  onChange: (value: string) => void
}

/** Right-aligned number with unit suffix. Arrow keys step value; Shift steps by ten units. */
export function NumberInput({ id, value, unit, invalid, autoFocus, decimals, onChange }: NumberInputProps) {
  return (
    <div data-invalid={invalid} className={cn("flex h-7 items-center px-2", FIELD_WRAPPER_CLASS)}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        value={value}
        autoFocus={autoFocus}
        aria-invalid={invalid}
        className="min-w-0 flex-1 bg-transparent text-right tabular-nums outline-none"
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const number = parseNumber(value)
          if (decimals !== undefined && Number.isFinite(number) && number.toFixed(decimals) !== value) {
            onChange(number.toFixed(decimals))
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
          event.preventDefault()
          onChange(stepValue(value, event.key === "ArrowUp" ? 1 : -1, event.shiftKey ? 10 : 1))
        }}
      />
      {unit && <span className="ml-1.5 shrink-0 text-xs text-muted-foreground">{unit}</span>}
    </div>
  )
}
