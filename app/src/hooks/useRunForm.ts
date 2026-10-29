import { useState } from "react"

import { useFlowOptions, usePrecision } from "@/hooks/usePrecision"
import type { RunParameters } from "@/lib/api"
import { fieldErrors, runFlowEntry, toFormValues, type RunFormValues } from "@/lib/runForm"

/**
 * Form of run parameters. `keepRunEntry`: run with soap film times or flow rate keeps its entry; otherwise entry
 * of Settings (new sample).
 */
export function useRunForm(initial: RunParameters, keepRunEntry = false) {
  const decimals = usePrecision()
  const flowOptions = useFlowOptions()
  const [values, setValues] = useState(() =>
    toFormValues(initial, decimals, {
      ...flowOptions,
      entry: keepRunEntry ? runFlowEntry(initial, flowOptions.entry) : flowOptions.entry,
    }),
  )
  const set = <K extends keyof RunFormValues>(key: K, value: RunFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))
  return { values, setValues, set, errors: fieldErrors(values) }
}
