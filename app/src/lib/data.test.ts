import { describe, expect, it } from "vitest"

import { concentration, detectEquilibrium, withGaps } from "@/lib/data"
import { stepValue } from "@/lib/step"
import { timeAxisEnd } from "@/lib/view"

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

describe("stepValue", () => {
  it("steps by last decimal place", () => {
    expect(stepValue("0.56", 1)).toBe("0.57")
    expect(stepValue("60", -1)).toBe("59")
    expect(stepValue("1,5", 1)).toBe("1.6")
    expect(stepValue("30.0", 1, 10)).toBe("31.0")
    expect(stepValue("", 1)).toBe("")
  })
})

describe("timeAxisEnd", () => {
  it("starts at 5000 s and grows by 1000 s near end", () => {
    expect(timeAxisEnd(0)).toBe(5000)
    expect(timeAxisEnd(3999)).toBe(5000)
    expect(timeAxisEnd(4000)).toBe(6000)
    expect(timeAxisEnd(4999)).toBe(6000)
    expect(timeAxisEnd(5000)).toBe(7000)
    expect(timeAxisEnd(Number.NaN)).toBe(5000)
  })
})
