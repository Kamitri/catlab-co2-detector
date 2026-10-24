import { describe, expect, it } from "vitest"

import { concentration, detectEquilibrium, withGaps } from "@/lib/data"
import { plotlyLocalTime } from "@/lib/format"

const options = { bandPercent: 3, durationS: 600, baselineWindowS: 60, delayS: 0 }

function series(values: (time: number) => number, length: number) {
  const x = Array.from({ length }, (_, index) => index + 1)
  return { x, y: x.map(values) }
}

describe("concentration", () => {
  it("matches vendor application", () => {
    expect(concentration(121, 1785.9, 0.0111)).toBeCloseTo(6841.60593465807, 8)
  })
})

describe("withGaps", () => {
  it("breaks line at gap", () => {
    const result = withGaps([0, 1000, 5000], [1, 2, 3], 1500)
    expect(result.y).toEqual([1, 2, null, 3])
  })
})

describe("detectEquilibrium", () => {
  it("ignores flat baseline before breakthrough", () => {
    expect(detectEquilibrium(series(() => 2700, 1200), options)).toBeNull()
  })

  it("detects plateau after breakthrough", () => {
    const result = detectEquilibrium(series((time) => (time < 300 ? 2700 : 32000 + (time % 2) * 300), 1200), options)
    expect(result).toBe(1200)
  })

  it("rejects rising curve", () => {
    expect(detectEquilibrium(series((time) => (time < 300 ? 2700 : 2700 + time * 30), 1200), options)).toBeNull()
  })

  it("rejects window with long gap", () => {
    const data = series((time) => (time < 300 ? 2700 : 32000), 700)
    data.x.push(1500)
    data.y.push(32000)
    expect(detectEquilibrium(data, options)).toBeNull()
  })
})

describe("plotlyLocalTime", () => {
  it("uses local time", () => {
    const timestamp = new Date(2026, 9, 24, 7, 5, 3, 9).getTime()
    expect(plotlyLocalTime(timestamp)).toBe("2026-10-24 07:05:03.009")
  })
})
