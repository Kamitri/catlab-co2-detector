import { createContext, useContext } from "react"

import { DEFAULT_DECIMALS, DEFAULT_FLOW_OPTIONS, type Decimals, type FlowOptions } from "@/lib/runForm"

/** Decimal places of sorbent mass, soap film volume and soap film time, from precision in Settings. */
export const PrecisionContext = createContext<Decimals>(DEFAULT_DECIMALS)

/** Number of soap film times and flow rate entry, from Settings. */
export const FlowOptionsContext = createContext<FlowOptions>(DEFAULT_FLOW_OPTIONS)

export function usePrecision(): Decimals {
  return useContext(PrecisionContext)
}

export function useFlowOptions(): FlowOptions {
  return useContext(FlowOptionsContext)
}
