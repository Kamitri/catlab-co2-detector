import { useEffect, useState } from "react"

import { AboutView } from "@/components/AboutView"
import { HistoryView } from "@/components/HistoryView"
import { LiveView } from "@/components/LiveView"
import { ConfirmDialog, FinishDialog, MarkerDialog, RecoveryDialog, StartDialog } from "@/components/RunDialogs"
import { SettingsDialog } from "@/components/SettingsDialog"
import { StatusPanel } from "@/components/StatusPanel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import icon from "@/assets/icon.png"
import { useMonitor } from "@/hooks/useMonitor"
import { api, events, type Run, type RunParameters, type Settings } from "@/lib/api"

type DialogState = "start" | "finish" | "marker" | "abort" | "settings" | "exit" | null
type View = "live" | "history" | "about"

function startDefaults(previous: Run | undefined, settings: Settings): RunParameters {
  const base: RunParameters = {
    sample: "",
    operator: "",
    note: "",
    flowRateMlMin: 60,
    flowMeasurements: [],
    massG: 1,
    densityGMl: 1,
    pressureBar: 1,
    temperatureC: 30,
    delayS: 0,
    baselineWindowS: settings.baselineWindowS,
    coWindowS: settings.coWindowS,
    blankRunId: null,
  }
  if (!previous) return base
  const { operator, flowRateMlMin, massG, densityGMl, pressureBar, temperatureC, blankRunId } = previous.parameters
  return { ...base, operator, flowRateMlMin, massG, densityGMl, pressureBar, temperatureC, blankRunId }
}

export default function App() {
  const { state, setSettings, dismissRecovery, applyRun } = useMonitor()
  const [view, setView] = useState<View>("live")
  const [dialog, setDialog] = useState<DialogState>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  // Exit from tray menu during run requires confirmation
  useEffect(() => {
    const unlisten = events.onExitRequested(() => setDialog("exit"))
    return () => void unlisten.then((dispose) => dispose())
  }, [])

  async function openStart() {
    setRuns(await api.listRuns())
    setDialog("start")
  }

  async function handle<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
      return await action()
    } catch (error) {
      await api.logMessage("error", String(error))
      return undefined
    }
  }

  const { activeRun, settings } = state
  const finishedRuns = runs.filter((run) => run.status !== "running")

  return (
    <div className="flex h-screen flex-col bg-background text-foreground select-none">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b px-4">
        <div className="flex items-center gap-2">
          <img src={icon} alt="" className="size-6" draggable={false} />
          <h1 className="text-sm font-semibold">
            CO<sub>2</sub> Monitor
          </h1>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto">
          <Button size="sm" variant="ghost" disabled={!settings} onClick={() => setDialog("settings")}>
            Settings
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {view === "live" ? (
            <LiveView
              state={state}
              onStart={() => void openStart()}
              onValveOpen={() => activeRun && void handle(() => api.addMarker(activeRun.id, "Valve open", true))}
              onMarker={() => setDialog("marker")}
              onFinish={() => setDialog("finish")}
              onAbort={() => setDialog("abort")}
            />
          ) : view === "history" ? (
            <HistoryView refreshKey={`${state.activeRun?.id}-${state.lastRun?.id}-${state.lastRun?.exportPath}`} />
          ) : (
            <AboutView />
          )}
        </main>
        <StatusPanel state={state} now={now} />
      </div>

      {dialog === "start" && settings && (
        <StartDialog
          defaults={startDefaults(runs[0], settings)}
          blankRuns={finishedRuns}
          onCancel={() => setDialog(null)}
          onStart={async (parameters) => {
            const run = await handle(() => api.startRun(parameters))
            if (run) {
              await applyRun(run)
              setView("live")
              setDialog(null)
            }
          }}
        />
      )}
      {dialog === "finish" && activeRun && (
        <FinishDialog
          run={activeRun}
          onCancel={() => setDialog(null)}
          onFinish={async (parameters) => {
            const run = await handle(() => api.finishRun(activeRun.id, parameters))
            if (run) {
              await applyRun(run)
              setDialog(null)
            }
          }}
        />
      )}
      {dialog === "marker" && activeRun && (
        <MarkerDialog
          onCancel={() => setDialog(null)}
          onAdd={(label) => {
            setDialog(null)
            void handle(() => api.addMarker(activeRun.id, label, false)).then(() => applyRun(activeRun))
          }}
        />
      )}
      {dialog === "abort" && activeRun && (
        <ConfirmDialog
          title="Abort run?"
          description={activeRun.parameters.sample}
          action="Abort"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={async () => {
            setDialog(null)
            const run = await handle(() => api.abortRun(activeRun.id))
            if (run) await applyRun(run)
          }}
        />
      )}
      {dialog === "exit" && (
        <ConfirmDialog
          title="Run in progress"
          action="Exit"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => void api.exitApp()}
        />
      )}
      {dialog === "settings" && settings && (
        <SettingsDialog
          settings={settings}
          onCancel={() => setDialog(null)}
          onSave={async (next) => {
            const saved = await handle(() => api.saveSettings(next))
            if (saved) {
              setSettings(saved)
              setDialog(null)
            }
          }}
        />
      )}
      {state.recoveredRun && dialog === null && (
        <RecoveryDialog
          run={state.recoveredRun}
          onResume={dismissRecovery}
          onFinish={() => {
            dismissRecovery()
            setDialog("finish")
          }}
        />
      )}
    </div>
  )
}
