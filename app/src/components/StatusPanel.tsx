import { revealItemInDir } from "@tauri-apps/plugin-opener"
import { useEffect, useRef } from "react"

import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import type { MonitorState } from "@/hooks/useMonitor"
import { concentration } from "@/lib/data"
import { formatClock, formatDuration, formatInteger, formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right tabular-nums">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2 px-4 py-3">
      <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h3>
      {children}
    </section>
  )
}

const LEVEL_COLORS = { info: "text-foreground", warning: "text-amber-600", error: "text-red-600" }

export function StatusPanel({ state, now }: { state: MonitorState; now: number }) {
  const { connection, latest, activeRun, settings, readings, equilibriumAt, lastRun, lastResult, messages } = state
  const messageEnd = useRef<HTMLDivElement>(null)

  useEffect(() => {
    messageEnd.current?.scrollIntoView({ block: "end" })
  }, [messages.length])

  const scale = activeRun?.conversionScale ?? settings?.conversionScale ?? 1785.9
  const exponent = activeRun?.conversionExponent ?? settings?.conversionExponent ?? 0.0111
  const fresh = latest !== null && now - latest.timestamp < 3000
  const connected = connection.state === "connected"

  let gapCount = 0
  if (activeRun) {
    for (let index = 1; index < readings.timestamps.length; index++) {
      if (readings.timestamps[index] - readings.timestamps[index - 1] > 1500) gapCount++
    }
  }

  return (
    <aside className="flex h-full w-80 shrink-0 flex-col border-l bg-sidebar">
      <Section title="Connection">
        <div className="flex items-center gap-2 text-sm">
          <span
            className={cn(
              "size-2 rounded-full",
              connected ? "bg-emerald-500" : "animate-pulse bg-amber-500",
            )}
          />
          <span className="font-medium">{connected ? "Connected" : "Searching"}</span>
          {connection.state === "connected" && <span className="text-muted-foreground">{connection.port}</span>}
        </div>
      </Section>
      <Separator />
      <Section title={<>CO<sub>2</sub></>}>
        <div className="flex items-baseline gap-2">
          <span className={cn("text-4xl font-semibold tabular-nums tracking-tight", !fresh && "text-muted-foreground")}>
            {latest ? formatInteger(concentration(latest.count, scale, exponent)) : "–"}
          </span>
          <span className="text-sm text-muted-foreground">ppm</span>
        </div>
        <Row label="N" value={latest ? latest.count : "–"} />
        <Row label="Updated" value={latest ? formatClock(latest.timestamp) : "–"} />
      </Section>
      <Separator />
      {activeRun ? (
        <Section title="Run">
          <Row label="Sample" value={activeRun.parameters.sample} />
          <Row label="Elapsed" value={formatDuration((now - activeRun.startedAt) / 1000)} />
          <Row label="Delay time" value={`${formatInteger(activeRun.parameters.delayS)} s`} />
          <Row label="Samples" value={formatInteger(readings.timestamps.length)} />
          <Row label="Gaps" value={gapCount} />
          <Row label="Equilibrium" value={equilibriumAt !== null ? formatDuration(equilibriumAt) : "–"} />
        </Section>
      ) : lastRun ? (
        <Section title="Last run">
          <Row label="Sample" value={lastRun.parameters.sample} />
          <Row label="Status" value={lastRun.status === "finished" ? "Finished" : "Aborted"} />
          <Row label="Capacity" value={`${formatNumber(lastResult?.capacityMgG)} mg/g`} />
          <Row label="Capacity" value={`${formatNumber(lastResult?.capacityMmolG, 3)} mmol/g`} />
          {lastRun.exportPath && (
            <Button
              variant="outline"
              size="sm"
              className="mt-1 w-full"
              onClick={() => void revealItemInDir(lastRun.exportPath!)}
            >
              Show file
            </Button>
          )}
        </Section>
      ) : (
        <Section title="Run">
          <Row label="State" value="Idle" />
        </Section>
      )}
      <Separator />
      <div className="flex min-h-0 flex-1 flex-col">
        <h3 className="px-4 pt-3 pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Messages</h3>
        <ScrollArea className="min-h-0 flex-1">
          <ul className="space-y-1 px-4 pb-3">
            {messages.map((message) => (
              <li key={message.id} className="flex gap-2 text-xs leading-5">
                <span className="shrink-0 text-muted-foreground tabular-nums">{formatClock(message.timestamp)}</span>
                <span className={cn("break-words", LEVEL_COLORS[message.level] ?? "")}>{message.text}</span>
              </li>
            ))}
          </ul>
          <div ref={messageEnd} />
        </ScrollArea>
      </div>
    </aside>
  )
}
