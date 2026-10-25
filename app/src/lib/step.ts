import { parseNumber } from "@/lib/runForm"

/**
 * Steps number text by one unit of its last decimal place, as arrow keys do in instrument software.
 * "0.56" steps by 0.01, "60" by 1; factor 10 steps by ten units. Text that is not a number stays unchanged.
 */
export function stepValue(text: string, direction: 1 | -1, factor = 1): string {
  const value = parseNumber(text)
  if (!Number.isFinite(value)) return text
  const decimals = text.trim().replace(",", ".").split(".")[1]?.length ?? 0
  const next = value + direction * factor * 10 ** -decimals
  return next.toFixed(decimals)
}
