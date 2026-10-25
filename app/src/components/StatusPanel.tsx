import { revealItemInDir } from "@tauri-apps/plugin-opener"

import { Button } from "@/components/ui/button"
import { MessageLog } from "@/components/MessageLog"
import { Separator } from "@/components/ui/separator"
import type { MonitorState } from "@/hooks/useMonitor"
import { concentration, GAP_THRESHOLD_MS } from "@/lib/data"
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

export function StatusPanel({ state, now }: { state: MonitorState; now: number }) {
  const { connection, latest, activeRun, settings, measurements, equilibriumAt, lastRun, lastResult, messages } = state
  const scale = activeRun?.conversionScale ?? settings?.conversionScale ?? 1785.9
  const exponent = activeRun?.conversionExponent ?? settings?.conversionExponent ?? 0.0111
  const fresh = latest !== null && now - latest.timestamp < 3000
  const connected = connection.state === "connected"

  // Time without measurements (s): intervals longer than gap threshold, minus 1 s expected interval
  let missingS = 0
  if (activeRun) {
    for (let index = 1; index < measurements.timestamps.length; index++) {
      const interval = measurements.timestamps[index] - measurements.timestamps[index - 1]
      if (interval > GAP_THRESHOLD_MS) missingS += interval / 1000 - 1
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
          <Row label="Samples" value={formatInteger(measurements.timestamps.length)} />
          <Row label="Missing data" value={`${formatInteger(missingS)} s`} />
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
                className="mt-1 w-full"
              onClick={() => void revealItemInDir(lastRun.exportPath!)}
            >
              Show in folder
            </Button>
          )}
        </Section>
      ) : (
        <Section title="Run">
          <Row label="State" value="Idle" />
        </Section>
      )}
      <Separator />
      <MessageLog messages={messages} />
    </aside>
  )
}
