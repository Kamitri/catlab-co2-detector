import { createContext, useContext } from "react"

import { DEFAULT_DECIMALS, type Decimals } from "@/lib/runForm"

/** Decimal places of sorbent mass and soap film volume, from precision in Settings. */
export const PrecisionContext = createContext<Decimals>(DEFAULT_DECIMALS)

export function usePrecision(): Decimals {
  return useContext(PrecisionContext)
}
