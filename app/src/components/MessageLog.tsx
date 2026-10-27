import { CircleX, Info, TriangleAlert, X } from "lucide-react"
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react"

import { ConfirmDialog } from "@/components/RunDialogs"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { Message, MessageLevel } from "@/lib/api"
import { formatClock } from "@/lib/format"
import { cn } from "@/lib/utils"

type Filter = "all" | "warning" | "error"

const LEVEL_STYLES: Record<MessageLevel, { icon: typeof Info; iconClass: string; rowClass: string; label: string }> = {
  info: { icon: Info, iconClass: "text-primary", rowClass: "", label: "Info" },
  warning: {
    icon: TriangleAlert,
    iconClass: "text-amber-600 dark:text-amber-400",
    rowClass: "bg-amber-50 dark:bg-amber-400/10",
    label: "Warning",
  },
  error: {
    icon: CircleX,
    iconClass: "text-red-600 dark:text-red-400",
    rowClass: "bg-red-50 dark:bg-red-400/10",
    label: "Error",
  },
}

/** Distance from bottom (px) within which log follows new messages. */
const FOLLOW_THRESHOLD = 24

function dayLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString("en-CA")
}

function visible(message: Message, filter: Filter): boolean {
  if (filter === "error") return message.level === "error"
  if (filter === "warning") return message.level !== "info"
  return true
}

export function MessageLog({
  messages,
  onDelete,
  onClear,
}: {
  messages: Message[]
  onDelete: (id: number) => void
  onClear: () => void
}) {
  const [filter, setFilter] = useState<Filter>("all")
  const [confirmClear, setConfirmClear] = useState(false)
  const viewport = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const shown = messages.filter((message) => visible(message, filter))
  const errorCount = messages.filter((message) => message.level === "error").length
  const warningCount = messages.filter((message) => message.level === "warning").length

  useLayoutEffect(() => {
    const element = viewport.current
    if (element && following.current) element.scrollTop = element.scrollHeight
  }, [shown.length, filter])

  useEffect(() => {
    following.current = true
  }, [filter])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-2">
        <h3 className="mr-auto text-xs font-medium tracking-wide text-muted-foreground uppercase">Messages</h3>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs text-destructive hover:text-destructive"
          disabled={messages.length === 0}
          onClick={() => setConfirmClear(true)}
        >
          Clear
        </Button>
        <Select value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <SelectTrigger size="sm" className="w-auto gap-1 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="end">
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="warning">Warnings and errors ({warningCount + errorCount})</SelectItem>
            <SelectItem value="error">Errors ({errorCount})</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div
        ref={viewport}
        className="min-h-0 flex-1 overflow-y-auto border-t select-text"
        onScroll={(event) => {
          const element = event.currentTarget
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_THRESHOLD
        }}
      >
        <ol>
          {shown.map((message, index) => {
            const style = LEVEL_STYLES[message.level] ?? LEVEL_STYLES.info
            const Icon = style.icon
            const day = dayLabel(message.timestamp)
            const newDay = index === 0 || dayLabel(shown[index - 1].timestamp) !== day
            return (
              <Fragment key={message.id}>
                {newDay && (
                  <li className="sticky top-0 z-10 border-b bg-sidebar/95 px-4 py-1 text-[11px] font-medium text-muted-foreground tabular-nums backdrop-blur">
                    {day}
                  </li>
                )}
                <li
                  className={cn(
                    "grid grid-cols-[14px_56px_1fr_14px] items-start gap-2 border-b border-border/60 px-4 py-1.5 text-xs leading-4",
                    style.rowClass,
                  )}
                  title={`${style.label} · ${new Date(message.timestamp).toLocaleString("en-GB")}`}
                >
                  <Icon className={cn("mt-px size-3.5", style.iconClass)} aria-label={style.label} />
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {formatClock(message.timestamp)}
                  </span>
                  <span className="break-words">{message.text}</span>
                  <button
                    type="button"
                    aria-label="Delete message"
                    className="mt-px rounded-sm text-muted-foreground/70 hover:text-foreground"
                    onClick={() => onDelete(message.id)}
                  >
                    <X className="size-3.5" />
                  </button>
                </li>
              </Fragment>
            )
          })}
        </ol>
      </div>
      {confirmClear && (
        <ConfirmDialog
          title="Are you sure?"
          description="This action will delete ALL messages. This action is irreversible."
          action="Clear"
          destructive
          onCancel={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false)
            onClear()
          }}
        />
      )}
    </div>
  )
}
