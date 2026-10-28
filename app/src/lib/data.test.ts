import { decimals } from "@/lib/settings"
import { describe, expect, it } from "vitest"

import { concentration, detectEquilibrium, withGaps } from "@/lib/data"
import type { RunParameters } from "@/lib/api"
import { toFormValues, toParameters } from "@/lib/runForm"
import { stepValue } from "@/lib/step"
import { RUN_TIME_AXIS, timeAxisEnd, timeTicks } from "@/lib/view"

const options = { bandPercent: 3, windowS: 300, delayS: 0 }

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

  it("starts at 2000 s during run and increases by 500 s", () => {
    expect(timeAxisEnd(0, RUN_TIME_AXIS)).toBe(2000)
    expect(timeAxisEnd(1499, RUN_TIME_AXIS)).toBe(2000)
    expect(timeAxisEnd(1500, RUN_TIME_AXIS)).toBe(2500)
  })
})

describe("toFormValues", () => {
  it("shows decimal places of balance and soap film flowmeter", () => {
    const values = toFormValues({ massG: 0.499, soapVolumeMl: 5, soapTimesS: [2.67] } as RunParameters)
    expect(values.massG).toBe("0.4990")
    expect(values.soapVolumeMl).toBe("5.0")
    expect(values.soapTimesS[0]).toBe("2.67")
  })
})

describe("timeTicks", () => {
  it("labels every 500 s with grid every 100 s in default view", () => {
    expect(timeTicks(5000)).toEqual({ label: 500, grid: 100 })
    expect(timeTicks(7000)).toEqual({ label: 500, grid: 100 })
    expect(timeTicks(1000)).toEqual({ label: 100, grid: 20 })
    expect(timeTicks(3000)).toEqual({ label: 200, grid: 50 })
    expect(timeTicks(20000)).toEqual({ label: 2000, grid: 500 })
  })
})

describe("decimals", () => {
  it("shows every multiple of precision step", () => {
    expect(decimals(0.0001)).toBe(4)
    expect(decimals(0.1)).toBe(1)
    expect(decimals(0.5)).toBe(1)
    expect(decimals(0.25)).toBe(2)
    expect(decimals(1)).toBe(0)
    expect(decimals(0)).toBe(0)
  })
})

describe("run form round trip", () => {
  it("keeps stored parameters unchanged, so Save of unedited run stays disabled", () => {
    const stored: RunParameters = {
      sample: "Na-ZY",
      operator: "Test",
      note: "",
      flowRateMlMin: 0,
      flowMeasurements: [],
      soapVolumeMl: 2.5,
      soapTimesS: [2.62, 2.75, 2.81],
      massG: 0.12345,
      densityGMl: 1,
      pressureBar: 1,
      temperatureC: 30,
      delayS: 0,
      coWindowS: 300,
      blankRunId: null,
    }
    const decimals = { massG: 2, soapVolumeMl: 0 }
    expect(JSON.stringify(toParameters(toFormValues(stored, decimals)))).toBe(JSON.stringify(stored))
  })
})
