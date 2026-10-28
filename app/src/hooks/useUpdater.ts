import { relaunch } from "@tauri-apps/plugin-process"
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater"
import { useCallback, useEffect, useState } from "react"

import { api } from "@/lib/api"

export type UpdateStatus =
  | "idle"
  | "checking"
  | "current"
  | "available"
  | "downloading"
  | "installing"
  | "failed"
  | "installFailed"

// Download fails when no data arrives for this time, instead of waiting without end
const STALL_MS = 60_000
// Limit for complete download request
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Checks GitHub release for newer version at start and on request. Check at start is silent when it fails,
 * for example without internet connection.
 */
export function useUpdater() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [status, setStatus] = useState<UpdateStatus>("idle")
  // Downloaded fraction (0 to 1), or null while size is unknown
  const [progress, setProgress] = useState<number | null>(null)

  const checkNow = useCallback(async () => {
    setStatus("checking")
    try {
      const found = await check()
      setUpdate(found)
      setStatus(found ? "available" : "current")
    } catch {
      setStatus("failed")
    }
  }, [])

  useEffect(() => {
    void checkNow()
  }, [checkNow])

  // Installer replaces application, then application starts again. On Windows, install ends application.
  const install = useCallback(async () => {
    if (!update) return
    setStatus("downloading")
    setProgress(null)
    try {
      let total = 0
      let received = 0
      let stallTimer = 0
      await new Promise<void>((resolve, reject) => {
        const watch = () => {
          window.clearTimeout(stallTimer)
          stallTimer = window.setTimeout(() => reject(new Error("no data received for 60 s")), STALL_MS)
        }
        watch()
        const onEvent = (event: DownloadEvent) => {
          watch()
          if (event.event === "Started") total = event.data.contentLength ?? 0
          if (event.event === "Progress") {
            received += event.data.chunkLength
            if (total > 0) setProgress(Math.min(received / total, 1))
          }
        }
        update.download(onEvent, { timeout: DOWNLOAD_TIMEOUT_MS }).then(resolve, reject)
      }).finally(() => window.clearTimeout(stallTimer))
      setStatus("installing")
      void api.logMessage("info", `Installing version ${update.version}`)
      await update.install()
      await relaunch()
    } catch (error) {
      setStatus("installFailed")
      void api.logMessage("error", `Update to ${update.version} failed: ${errorText(error)}`)
    }
  }, [update])

  return { update, status, progress, checkNow, install }
}
