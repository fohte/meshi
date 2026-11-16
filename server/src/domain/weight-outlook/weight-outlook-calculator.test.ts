import { expect, it } from 'vitest'

import type { BodyWeight } from '#domain/body-weight/types'
import { calculateWeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

const AS_OF = jstDateSchema.parse('2026-11-17')
const START_DATE = jstDateSchema.parse('2026-10-21')
const RECENT_OFFSETS = Array.from({ length: 28 }, (_, index) => index)

const shiftDate = (date: JstDate, days: number): JstDate =>
  jstDateSchema.parse(Temporal.PlainDate.from(date).add({ days }).toString())

const rounded = (value: number): number =>
  Math.round(value * 1_000_000) / 1_000_000

const weight = (date: JstDate, weightKg: number, id: string): BodyWeight => ({
  id,
  date,
  measuredAt: null,
  weightKg,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
})

const linearWeights = (
  firstWeightKg: number,
  slopeKgPerDay: number,
  offsets: ReadonlyArray<number> = RECENT_OFFSETS,
): BodyWeight[] =>
  offsets.map((offset) =>
    weight(
      shiftDate(AS_OF, offset - 27),
      firstWeightKg + slopeKgPerDay * offset,
      `weight_${String(offset)}`,
    ),
  )

interface ExpectedOutlookInput {
  readonly weights: ReadonlyArray<BodyWeight>
  readonly firstMeasurementDate: JstDate | null
  readonly goalWeightKg: number | null
  readonly status:
    | 'insufficient_data'
    | 'no_goal'
    | 'reached'
    | 'not_approaching'
    | 'no_arrival_estimate'
    | 'arrival_estimate'
  readonly reason:
    | 'first_measurement_too_recent'
    | 'too_few_measurement_days'
    | 'measurement_gap'
    | null
  readonly linearTrend?: {
    readonly firstWeightKg: number
    readonly slopeKgPerDay: number
  }
  readonly arrivalDateRange?: {
    readonly from: JstDate
    readonly to: JstDate
  } | null
}

const normalizeOutlook = (
  outlook: ReturnType<typeof calculateWeightOutlook>,
) => ({
  ...outlook,
  points: outlook.points.map((point) => ({
    ...point,
    weightKg: rounded(point.weightKg),
  })),
  latestWeightKg:
    outlook.latestWeightKg === null ? null : rounded(outlook.latestWeightKg),
  trend:
    outlook.trend === null
      ? null
      : {
          ...outlook.trend,
          slopeKgPerDay: rounded(outlook.trend.slopeKgPerDay),
          slopeKgPerWeek: rounded(outlook.trend.slopeKgPerWeek),
          points: outlook.trend.points.map((point) => ({
            date: point.date,
            weightKg: rounded(point.weightKg),
            lowerKg: rounded(point.lowerKg),
            upperKg: rounded(point.upperKg),
          })),
        },
})

const expectedOutlook = (input: ExpectedOutlookInput) => {
  const {
    weights,
    goalWeightKg,
    status,
    reason,
    linearTrend,
    arrivalDateRange = null,
  } = input
  const byDate = new Map<string, number[]>()
  for (const { date, weightKg } of weights) {
    const values = byDate.get(date) ?? []
    values.push(weightKg)
    byDate.set(date, values)
  }
  const points = [...byDate]
    .filter(([date]) => date >= START_DATE && date <= AS_OF)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, values]) => ({
      date: jstDateSchema.parse(date),
      weightKg: rounded(
        values.reduce((sum, value) => sum + value, 0) / values.length,
      ),
    }))
  const trendPoints =
    linearTrend === undefined
      ? null
      : Array.from({ length: 112 }, (_, index) => {
          const value = rounded(
            linearTrend.firstWeightKg + linearTrend.slopeKgPerDay * index,
          )
          return {
            date: shiftDate(START_DATE, index),
            weightKg: value,
            lowerKg: value,
            upperKg: value,
          }
        })
  return {
    asOf: AS_OF,
    points,
    latestWeightKg: points.at(-1)?.weightKg ?? null,
    goalWeightKg,
    trend:
      trendPoints === null || linearTrend === undefined
        ? null
        : {
            slopeKgPerDay: rounded(linearTrend.slopeKgPerDay),
            slopeKgPerWeek: rounded(linearTrend.slopeKgPerDay * 7),
            points: trendPoints,
          },
    status,
    reason,
    arrivalDateRange,
  }
}

const calculate = (
  weights: ReadonlyArray<BodyWeight>,
  firstMeasurementDate: JstDate | null,
  goalWeightKg: number | null,
) =>
  normalizeOutlook(
    calculateWeightOutlook(weights, firstMeasurementDate, AS_OF, goalWeightKg),
  )

it('reports when the first measurement is less than 28 days old', () => {
  const weights = linearWeights(70, -0.1).filter(
    ({ date }) => date !== START_DATE,
  )
  expect(calculate(weights, shiftDate(AS_OF, -26), 65)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: shiftDate(AS_OF, -26),
      goalWeightKg: 65,
      status: 'insufficient_data',
      reason: 'first_measurement_too_recent',
    }),
  )
})

it('reports when fewer than 16 calendar days have measurements', () => {
  const weights = linearWeights(70, -0.1, [
    ...Array.from({ length: 14 }, (_, index) => index * 2),
    27,
  ])
  expect(calculate(weights, shiftDate(AS_OF, -40), 65)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: shiftDate(AS_OF, -40),
      goalWeightKg: 65,
      status: 'insufficient_data',
      reason: 'too_few_measurement_days',
    }),
  )
})

it('reports when one of the four fixed seven-day intervals has fewer than two measurements', () => {
  const weights = linearWeights(70, -0.1, [
    0,
    ...Array.from({ length: 5 }, (_, index) => index + 7),
    ...Array.from({ length: 5 }, (_, index) => index + 14),
    ...Array.from({ length: 5 }, (_, index) => index + 22),
  ])
  expect(calculate(weights, START_DATE, 65)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 65,
      status: 'insufficient_data',
      reason: 'measurement_gap',
    }),
  )
})

it('returns a complete trend when the profile has no goal', () => {
  const weights = linearWeights(70, -0.1)
  expect(calculate(weights, START_DATE, null)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: null,
      status: 'no_goal',
      reason: null,
      linearTrend: { firstWeightKg: 70, slopeKgPerDay: -0.1 },
    }),
  )
})

it('reports a goal reached after the trend has stayed past it for seven days', () => {
  const weights = linearWeights(66.5, -0.1)
  expect(calculate(weights, START_DATE, 65)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 65,
      status: 'reached',
      reason: null,
      linearTrend: { firstWeightKg: 66.5, slopeKgPerDay: -0.1 },
    }),
  )
})

it('reports when the slope interval is not exclusively toward the goal', () => {
  const weights = linearWeights(70, 0.1)
  expect(calculate(weights, START_DATE, 60)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 60,
      status: 'not_approaching',
      reason: null,
      linearTrend: { firstWeightKg: 70, slopeKgPerDay: 0.1 },
    }),
  )
})

it('reports when the confidence band does not reach the goal within 12 weeks', () => {
  const weights = linearWeights(70, -0.001)
  expect(calculate(weights, START_DATE, 60)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 60,
      status: 'no_arrival_estimate',
      reason: null,
      linearTrend: { firstWeightKg: 70, slopeKgPerDay: -0.001 },
    }),
  )
})

it('returns the earliest and latest goal arrival dates for a weight loss trend', () => {
  const weights = linearWeights(70, -0.1)
  expect(calculate(weights, START_DATE, 65)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 65,
      status: 'arrival_estimate',
      reason: null,
      linearTrend: { firstWeightKg: 70, slopeKgPerDay: -0.1 },
      arrivalDateRange: {
        from: shiftDate(AS_OF, 23),
        to: shiftDate(AS_OF, 23),
      },
    }),
  )
})

it('uses the upward goal direction when the target is heavier than the trend', () => {
  const weights = linearWeights(70, 0.1)
  expect(calculate(weights, START_DATE, 75)).toEqual(
    expectedOutlook({
      weights,
      firstMeasurementDate: START_DATE,
      goalWeightKg: 75,
      status: 'arrival_estimate',
      reason: null,
      linearTrend: { firstWeightKg: 70, slopeKgPerDay: 0.1 },
      arrivalDateRange: {
        from: shiftDate(AS_OF, 23),
        to: shiftDate(AS_OF, 23),
      },
    }),
  )
})

it('averages same-day measurements and returns the complete 80% confidence band', () => {
  const weights = [
    ...linearWeights(70, -0.1).filter(({ date }) => date !== AS_OF),
    weight(AS_OF, 68, 'same_day_first'),
    weight(AS_OF, 70, 'same_day_second'),
  ]
  const delta = 1.7
  const meanX = 13.5
  const sumSquaredX = 1827
  const slopeKgPerDay = -0.1 + (delta * (27 - meanX)) / sumSquaredX
  const intercept = 68.65 + delta / 28 - slopeKgPerDay * meanX
  const leverageAtLastDay = 1 / 28 + (27 - meanX) ** 2 / sumSquaredX
  const residualStandardError = Math.sqrt(
    (delta ** 2 * (1 - leverageAtLastDay)) / 26,
  )
  const marginAt = (x: number): number =>
    1.315 *
    residualStandardError *
    Math.sqrt(1 / 28 + (x - meanX) ** 2 / sumSquaredX)
  const expectedTrendPoints = Array.from({ length: 112 }, (_, index) => {
    const weightKg = intercept + slopeKgPerDay * index
    const margin = marginAt(index)
    return {
      date: shiftDate(START_DATE, index),
      weightKg: rounded(weightKg),
      lowerKg: rounded(weightKg - margin),
      upperKg: rounded(weightKg + margin),
    }
  })
  const expected = expectedOutlook({
    weights,
    firstMeasurementDate: START_DATE,
    goalWeightKg: null,
    status: 'no_goal',
    reason: null,
  })
  expect(calculate(weights, START_DATE, null)).toEqual({
    ...expected,
    trend: {
      slopeKgPerDay: rounded(slopeKgPerDay),
      slopeKgPerWeek: rounded(slopeKgPerDay * 7),
      points: expectedTrendPoints,
    },
  })
})
