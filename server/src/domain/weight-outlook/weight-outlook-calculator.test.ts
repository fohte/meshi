import { expect, it } from 'vitest'

import type { BodyWeight } from '#domain/body-weight/types'
import { calculateWeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

const AS_OF = jstDateSchema.parse('2026-11-17')

const shiftDate = (date: JstDate, days: number): JstDate =>
  jstDateSchema.parse(Temporal.PlainDate.from(date).add({ days }).toString())

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
  offsets: ReadonlyArray<number> = Array.from({ length: 28 }, (_, i) => i),
): BodyWeight[] =>
  offsets.map((offset) =>
    weight(
      shiftDate(AS_OF, offset - 27),
      firstWeightKg + slopeKgPerDay * offset,
      `weight_${String(offset)}`,
    ),
  )

const round = (value: number | null): number | null =>
  value === null ? null : Math.round(value * 1_000_000) / 1_000_000

const decisionSnapshot = (
  outlook: ReturnType<typeof calculateWeightOutlook>,
) => {
  const asOfTrendPoint = outlook.trend?.points.find(
    ({ date }) => date === AS_OF,
  )
  const finalTrendPoint = outlook.trend?.points.at(-1)
  return {
    asOf: outlook.asOf,
    points: {
      count: outlook.points.length,
      first: outlook.points[0] ?? null,
      last: outlook.points.at(-1) ?? null,
    },
    latestWeightKg: round(outlook.latestWeightKg),
    trendPointCount: outlook.trend?.points.length ?? null,
    goalWeightKg: outlook.goalWeightKg,
    trend:
      outlook.trend === null
        ? null
        : {
            slopeKgPerDay: round(outlook.trend.slopeKgPerDay),
            slopeKgPerWeek: round(outlook.trend.slopeKgPerWeek),
            asOf:
              asOfTrendPoint === undefined
                ? null
                : {
                    weightKg: round(asOfTrendPoint.weightKg),
                    lowerKg: round(asOfTrendPoint.lowerKg),
                    upperKg: round(asOfTrendPoint.upperKg),
                  },
            forecastEnd:
              finalTrendPoint === undefined
                ? null
                : {
                    date: finalTrendPoint.date,
                    weightKg: round(finalTrendPoint.weightKg),
                    lowerKg: round(finalTrendPoint.lowerKg),
                    upperKg: round(finalTrendPoint.upperKg),
                  },
          },
    status: outlook.status,
    reason: outlook.reason,
    arrivalDateRange: outlook.arrivalDateRange,
  }
}

it('reports when the first measurement is less than 28 days old', () => {
  const outlook = calculateWeightOutlook(
    linearWeights(70, -0.1).filter(
      (point) => point.date !== shiftDate(AS_OF, -27),
    ),
    AS_OF,
    65,
  )
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 27,
      first: { date: shiftDate(AS_OF, -26), weightKg: 69.9 },
      last: { date: AS_OF, weightKg: 67.3 },
    },
    latestWeightKg: 67.3,
    trendPointCount: null,
    goalWeightKg: 65,
    trend: null,
    status: 'insufficient_data',
    reason: 'first_measurement_too_recent',
    arrivalDateRange: null,
  })
})

it('reports when fewer than 16 calendar days have measurements', () => {
  const weights = [
    weight(shiftDate(AS_OF, -40), 72, 'old'),
    ...linearWeights(70, -0.1, [
      ...Array.from({ length: 14 }, (_, i) => i * 2),
      27,
    ]),
  ]
  const outlook = calculateWeightOutlook(weights, AS_OF, 65)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 15,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 67.3 },
    },
    latestWeightKg: 67.3,
    trendPointCount: null,
    goalWeightKg: 65,
    trend: null,
    status: 'insufficient_data',
    reason: 'too_few_measurement_days',
    arrivalDateRange: null,
  })
})

it('reports when any seven day interval has fewer than two measurements', () => {
  const weights = linearWeights(70, -0.1, [
    0,
    ...Array.from({ length: 5 }, (_, i) => i + 7),
    ...Array.from({ length: 5 }, (_, i) => i + 14),
    ...Array.from({ length: 5 }, (_, i) => i + 22),
  ])
  const outlook = calculateWeightOutlook(weights, AS_OF, 65)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 16,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: shiftDate(AS_OF, -1), weightKg: 67.4 },
    },
    latestWeightKg: 67.4,
    trendPointCount: null,
    goalWeightKg: 65,
    trend: null,
    status: 'insufficient_data',
    reason: 'measurement_gap',
    arrivalDateRange: null,
  })
})

it('returns a trend without a target when the profile has no goal', () => {
  const outlook = calculateWeightOutlook(linearWeights(70, -0.1), AS_OF, null)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 67.3 },
    },
    latestWeightKg: 67.3,
    trendPointCount: 112,
    goalWeightKg: null,
    trend: {
      slopeKgPerDay: -0.1,
      slopeKgPerWeek: -0.7,
      asOf: { weightKg: 67.3, lowerKg: 67.3, upperKg: 67.3 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 58.9,
        lowerKg: 58.9,
        upperKg: 58.9,
      },
    },
    status: 'no_goal',
    reason: null,
    arrivalDateRange: null,
  })
})

it('reports a goal reached after the trend has stayed past it for seven days', () => {
  const outlook = calculateWeightOutlook(linearWeights(66.5, -0.1), AS_OF, 65)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 66.5 },
      last: { date: AS_OF, weightKg: 63.8 },
    },
    latestWeightKg: 63.8,
    trendPointCount: 112,
    goalWeightKg: 65,
    trend: {
      slopeKgPerDay: -0.1,
      slopeKgPerWeek: -0.7,
      asOf: { weightKg: 63.8, lowerKg: 63.8, upperKg: 63.8 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 55.4,
        lowerKg: 55.4,
        upperKg: 55.4,
      },
    },
    status: 'reached',
    reason: null,
    arrivalDateRange: null,
  })
})

it('reports when the slope interval is not exclusively toward the goal', () => {
  const outlook = calculateWeightOutlook(linearWeights(70, 0.1), AS_OF, 60)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 72.7 },
    },
    latestWeightKg: 72.7,
    trendPointCount: 112,
    goalWeightKg: 60,
    trend: {
      slopeKgPerDay: 0.1,
      slopeKgPerWeek: 0.7,
      asOf: { weightKg: 72.7, lowerKg: 72.7, upperKg: 72.7 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 81.1,
        lowerKg: 81.1,
        upperKg: 81.1,
      },
    },
    status: 'not_approaching',
    reason: null,
    arrivalDateRange: null,
  })
})

it('reports when the confidence band does not reach the goal within 12 weeks', () => {
  const outlook = calculateWeightOutlook(linearWeights(70, -0.001), AS_OF, 60)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 69.973 },
    },
    latestWeightKg: 69.973,
    trendPointCount: 112,
    goalWeightKg: 60,
    trend: {
      slopeKgPerDay: -0.001,
      slopeKgPerWeek: -0.007,
      asOf: { weightKg: 69.973, lowerKg: 69.973, upperKg: 69.973 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 69.889,
        lowerKg: 69.889,
        upperKg: 69.889,
      },
    },
    status: 'no_arrival_estimate',
    reason: null,
    arrivalDateRange: null,
  })
})

it('returns the earliest and latest goal arrival dates for a weight loss trend', () => {
  const outlook = calculateWeightOutlook(linearWeights(70, -0.1), AS_OF, 65)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 67.3 },
    },
    latestWeightKg: 67.3,
    trendPointCount: 112,
    goalWeightKg: 65,
    trend: {
      slopeKgPerDay: -0.1,
      slopeKgPerWeek: -0.7,
      asOf: { weightKg: 67.3, lowerKg: 67.3, upperKg: 67.3 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 58.9,
        lowerKg: 58.9,
        upperKg: 58.9,
      },
    },
    status: 'arrival_estimate',
    reason: null,
    arrivalDateRange: {
      from: shiftDate(AS_OF, 23),
      to: shiftDate(AS_OF, 23),
    },
  })
})

it('uses the upward goal direction when the target is heavier than the trend', () => {
  const outlook = calculateWeightOutlook(linearWeights(70, 0.1), AS_OF, 75)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 72.7 },
    },
    latestWeightKg: 72.7,
    trendPointCount: 112,
    goalWeightKg: 75,
    trend: {
      slopeKgPerDay: 0.1,
      slopeKgPerWeek: 0.7,
      asOf: { weightKg: 72.7, lowerKg: 72.7, upperKg: 72.7 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 81.1,
        lowerKg: 81.1,
        upperKg: 81.1,
      },
    },
    status: 'arrival_estimate',
    reason: null,
    arrivalDateRange: {
      from: shiftDate(AS_OF, 23),
      to: shiftDate(AS_OF, 23),
    },
  })
})

it('averages multiple measurements from the same calendar day into one point', () => {
  const weights = [
    ...linearWeights(70, -0.1).filter((point) => point.date !== AS_OF),
    weight(AS_OF, 68, 'same_day_first'),
    weight(AS_OF, 70, 'same_day_second'),
  ]
  const outlook = calculateWeightOutlook(weights, AS_OF, null)
  expect(decisionSnapshot(outlook)).toEqual({
    asOf: AS_OF,
    points: {
      count: 28,
      first: { date: shiftDate(AS_OF, -27), weightKg: 70 },
      last: { date: AS_OF, weightKg: 69 },
    },
    latestWeightKg: 69,
    trendPointCount: 112,
    goalWeightKg: null,
    trend: {
      slopeKgPerDay: -0.087438,
      slopeKgPerWeek: -0.612069,
      asOf: { weightKg: 67.530296, lowerKg: 67.380259, upperKg: 67.680332 },
      forecastEnd: {
        date: shiftDate(AS_OF, 84),
        weightKg: 60.185468,
        lowerKg: 59.25243,
        upperKg: 61.118506,
      },
    },
    status: 'no_goal',
    reason: null,
    arrivalDateRange: null,
  })
})
