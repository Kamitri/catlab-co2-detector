import { relaunch } from "@tauri-apps/plugin-process"
import { check, type Update } from "@tauri-apps/plugin-updater"
import { useCallback, useEffect, useState } from "react"

export type UpdateStatus = "idle" | "checking" | "current" | "available" | "installing" | "failed"

/**
 * Checks GitHub release for newer version at start and on request. Check at start is silent when it fails,
 * for example without internet connection.
 */
export function useUpdater() {
  const [update, setUpdate] = useState<Update | null>(null)
  const [status, setStatus] = useState<UpdateStatus>("idle")

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

  // Installer replaces application, then application starts again
  const install = useCallback(async () => {
    if (!update) return
    setStatus("installing")
    try {
      await update.downloadAndInstall()
      await relaunch()
    } catch {
      setStatus("failed")
    }
  }, [update])

  return { update, status, checkNow, install }
}
