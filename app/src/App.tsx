import { useEffect, useMemo, useState } from "react"

import { AboutView } from "@/components/AboutView"
import { HistoryView } from "@/components/HistoryView"
import { LiveView } from "@/components/LiveView"
import { ManualView } from "@/components/ManualView"
import { ConfirmDialog, FinishDialog, MarkerDialog, RecoveryDialog, SampleDialog } from "@/components/RunDialogs"
import { SettingsDialog } from "@/components/SettingsDialog"
import { StatusPanel } from "@/components/StatusPanel"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import icon from "@/assets/icon.png"
import { useMonitor } from "@/hooks/useMonitor"
import { PrecisionContext } from "@/hooks/usePrecision"
import { useTheme } from "@/hooks/useTheme"
import { useUpdater } from "@/hooks/useUpdater"
import { api, events, type Run, type RunParameters, type Settings } from "@/lib/api"
import { DEFAULT_SETTINGS, decimals } from "@/lib/settings"

type DialogState =
  | "sample"
  | "finish"
  | "marker"
  | "abort"
  | "clear"
  | "settings"
  | "exit"
  | "close"
  | "update"
  | null
type View = "live" | "history" | "manual" | "about"

function startDefaults(previous: Run | undefined, settings: Settings): RunParameters {
  const base: RunParameters = {
    sample: "",
    operator: "",
    note: "",
    flowRateMlMin: 0,
    flowMeasurements: [],
    soapVolumeMl: 5,
    soapTimesS: [],
    massG: 1,
    densityGMl: 1,
    pressureBar: 1,
    temperatureC: 30,
    delayS: 0,
    coWindowS: settings.coWindowS,
    blankRunId: null,
  }
  if (!previous) return base
  const { operator, soapVolumeMl, massG, densityGMl, pressureBar, temperatureC, blankRunId } = previous.parameters
  return { ...base, operator, soapVolumeMl, massG, densityGMl, pressureBar, temperatureC, blankRunId }
}

export default function App() {
  const { state, setSettings, setSample, dismissRecovery, applyRun, clearChart, deleteMessage, clearMessages } =
    useMonitor()
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

  // Close button of window asks before window is hidden to tray
  useEffect(() => {
    const unlisten = events.onCloseRequested(() => setDialog("close"))
    return () => void unlisten.then((dispose) => dispose())
  }, [])

  async function openSample() {
    setRuns(await api.listRuns())
    setDialog("sample")
  }

  // Start is one click: run starts at once with sample configured before
  async function start() {
    const run = await handle(() => api.startRun())
    if (run) await applyRun(run)
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
  useTheme(settings?.theme)
  const updater = useUpdater()
  const updating = updater.status === "downloading" || updater.status === "installing"
  const precision = useMemo(
    () => ({
      massG: decimals(settings?.massPrecisionG ?? DEFAULT_SETTINGS.massPrecisionG),
      soapVolumeMl: decimals(settings?.soapVolumePrecisionMl ?? DEFAULT_SETTINGS.soapVolumePrecisionMl),
    }),
    [settings?.massPrecisionG, settings?.soapVolumePrecisionMl],
  )

  const content = (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-6 border-b px-4">
        <div className="flex items-center gap-2">
          <img src={icon} alt="" className="size-6" draggable={false} />
          <h1 className="text-sm font-semibold">
            CATlab CO<sub>2</sub> Monitor
          </h1>
        </div>
        <Tabs value={view} onValueChange={(value) => setView(value as View)}>
          <TabsList>
            <TabsTrigger value="live">Live</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="manual">Manual</TabsTrigger>
            <TabsTrigger value="about">About</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="ml-auto flex items-center gap-2">
          {updater.update && (
            // Install restarts application, so it waits until run is finished
            <Button disabled={activeRun !== null || updating} onClick={() => setDialog("update")}>
              {updater.status === "downloading"
                ? `Downloading${updater.progress === null ? "" : ` ${Math.round(updater.progress * 100)} %`}`
                : updater.status === "installing"
                  ? "Installing"
                  : `Update to ${updater.update.version}`}
            </Button>
          )}
          <Button variant="ghost" disabled={!settings} onClick={() => setDialog("settings")}>
            Settings
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col">
          {view === "live" ? (
            <LiveView
              state={state}
              onSample={() => void openSample()}
              onStart={() => void start()}
              onMarker={() => setDialog("marker")}
              onFinish={() => setDialog("finish")}
              onAbort={() => setDialog("abort")}
              onClear={() => setDialog("clear")}
            />
          ) : view === "history" ? (
            <HistoryView refreshKey={`${state.activeRun?.id}-${state.lastRun?.id}-${state.lastRun?.exportPath}`} />
          ) : view === "manual" ? (
            <ManualView />
          ) : (
            <AboutView updater={updater} />
          )}
        </main>
        <StatusPanel
          state={state}
          now={now}
          onDeleteMessage={(id) => void handle(() => deleteMessage(id))}
          onClearMessages={() => void handle(clearMessages)}
        />
      </div>

      {dialog === "sample" && settings && (
        <SampleDialog
          defaults={activeRun?.parameters ?? state.sample ?? startDefaults(runs[0], settings)}
          blankRuns={finishedRuns.filter((run) => run.id !== activeRun?.id)}
          showDelay={activeRun !== null}
          onCancel={() => setDialog(null)}
          onSave={async (parameters) => {
            if (activeRun) {
              const run = await handle(() => api.updateRun(activeRun.id, parameters))
              if (run) await applyRun(run)
            } else {
              const saved = await handle(() => api.saveSample(parameters))
              if (saved) setSample(saved)
            }
            setDialog(null)
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
            void handle(() => api.addMarker(activeRun.id, label)).then(() => applyRun(activeRun))
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
      {dialog === "clear" && !activeRun && (
        <ConfirmDialog
          title="Are you sure?"
          description="This action will delete ALL your current chart data. This action is irreversible."
          action="Clear chart"
          destructive
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void handle(clearChart)
          }}
        />
      )}
      {dialog === "update" && updater.update && (
        <ConfirmDialog
          title={`Install version ${updater.update.version}?`}
          action="Install"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void updater.install()
          }}
        />
      )}
      {dialog === "close" && (
        <ConfirmDialog
          title="Do you want to close the app?"
          description="Data will be recorded while the app is closed. To fully close the app, exit from the system tray."
          action="Close"
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setDialog(null)
            void handle(api.hideWindow)
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
  return <PrecisionContext.Provider value={precision}>{content}</PrecisionContext.Provider>
}
