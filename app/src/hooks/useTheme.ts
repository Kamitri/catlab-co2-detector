import { getCurrentWindow } from "@tauri-apps/api/window"
import { useEffect, useSyncExternalStore } from "react"

import type { Theme } from "@/lib/api"

const DARK_QUERY = "(prefers-color-scheme: dark)"

/** Applies theme of Settings: class "dark" on html element and theme of native window. */
export function useTheme(theme: Theme | undefined) {
  useEffect(() => {
    if (!theme) return
    const media = window.matchMedia(DARK_QUERY)
    const apply = () => {
      const dark = theme === "dark" || (theme === "system" && media.matches)
      document.documentElement.classList.toggle("dark", dark)
    }
    apply()
    void getCurrentWindow()
      .setTheme(theme === "system" ? null : theme)
      .catch(() => undefined)
    media.addEventListener("change", apply)
    return () => media.removeEventListener("change", apply)
  }, [theme])
}

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
  return () => observer.disconnect()
}

/** True while dark theme is applied; for colors that CSS cannot set, such as chart colors. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, () => document.documentElement.classList.contains("dark"))
}
