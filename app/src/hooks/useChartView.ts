import { useCallback, useState } from "react"

import type { View } from "@/lib/view"

/**
 * Chart view: default view follows data; after zoom, pan, or Axes, view keeps user setting until reset.
 * Changing resetKey (for example new run) returns to default view.
 */
export function useChartView(defaultView: View, resetKey: string) {
  const [manual, setManual] = useState<{ key: string; view: View } | null>(null)
  const active = manual !== null && manual.key === resetKey
  const setView = useCallback((view: View) => setManual({ key: resetKey, view }), [resetKey])
  const reset = useCallback(() => setManual(null), [])
  return { view: active ? manual.view : defaultView, manual: active, setView, reset }
}
