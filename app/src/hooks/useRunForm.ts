import { useState } from "react"

import { usePrecision } from "@/hooks/usePrecision"
import type { RunParameters } from "@/lib/api"
import { fieldErrors, toFormValues, type RunFormValues } from "@/lib/runForm"

export function useRunForm(initial: RunParameters) {
  const decimals = usePrecision()
  const [values, setValues] = useState(() => toFormValues(initial, decimals))
  const set = <K extends keyof RunFormValues>(key: K, value: RunFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }))
  return { values, setValues, set, errors: fieldErrors(values) }
}
