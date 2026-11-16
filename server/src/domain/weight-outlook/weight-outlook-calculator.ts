import type { BodyWeight } from '#domain/body-weight/types'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

export const WEIGHT_OUTLOOK_POLICY = {
  windowDays: 28,
  minimumMeasurementDays: 16,
  daysPerWeek: 7,
  minimumMeasurementsPerWeek: 2,
  forecastDays: 84,
  tCriticalFor80PercentIntervalByDegreesOfFreedom: {
    14: 1.345,
    15: 1.341,
    16: 1.337,
    17: 1.333,
    18: 1.33,
    19: 1.328,
    20: 1.325,
    21: 1.323,
    22: 1.321,
    23: 1.319,
    24: 1.318,
    25: 1.316,
    26: 1.315,
  },
} as const

type WeightOutlookStatus =
  | 'insufficient_data'
  | 'no_goal'
  | 'reached'
  | 'not_approaching'
  | 'no_arrival_estimate'
  | 'arrival_estimate'

type WeightOutlookReason =
  | 'first_measurement_too_recent'
  | 'too_few_measurement_days'
  | 'measurement_gap'

interface WeightOutlookPoint {
  readonly date: JstDate
  readonly weightKg: number
}

interface WeightOutlookTrendPoint {
  readonly date: JstDate
  readonly weightKg: number
  readonly lowerKg: number
  readonly upperKg: number
}

export interface WeightOutlook {
  readonly asOf: JstDate
  readonly points: ReadonlyArray<WeightOutlookPoint>
  readonly latestWeightKg: number | null
  readonly goalWeightKg: number | null
  readonly trend: {
    readonly slopeKgPerDay: number
    readonly slopeKgPerWeek: number
    readonly points: ReadonlyArray<WeightOutlookTrendPoint>
  } | null
  readonly status: WeightOutlookStatus
  readonly reason: WeightOutlookReason | null
  readonly arrivalDateRange: {
    readonly from: JstDate
    readonly to: JstDate
  } | null
}

interface DailyPoint {
  readonly date: JstDate
  readonly weightKg: number
}

interface Regression {
  readonly slope: number
  readonly intercept: number
  readonly meanX: number
  readonly sumSquaredX: number
  readonly residualStandardError: number
  readonly tCritical: number
}

const shiftDate = (date: JstDate, days: number): JstDate =>
  jstDateSchema.parse(Temporal.PlainDate.from(date).add({ days }).toString())

export const getWeightOutlookStartDate = (asOf: JstDate): JstDate =>
  shiftDate(asOf, -(WEIGHT_OUTLOOK_POLICY.windowDays - 1))

const daysBetween = (from: JstDate, to: JstDate): number =>
  Temporal.PlainDate.from(from).until(Temporal.PlainDate.from(to), {
    largestUnit: 'day',
  }).days

const averageByDate = (weights: ReadonlyArray<BodyWeight>): DailyPoint[] => {
  const byDate = new Map<string, { total: number; count: number }>()
  for (const { date, weightKg } of weights) {
    const current = byDate.get(date) ?? { total: 0, count: 0 }
    current.total += weightKg
    current.count += 1
    byDate.set(date, current)
  }
  return [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({
      date: jstDateSchema.parse(date),
      weightKg: value.total / value.count,
    }))
}

const findInsufficientReason = (
  firstMeasurementDate: JstDate | null,
  recentPoints: ReadonlyArray<DailyPoint>,
  startDate: JstDate,
): WeightOutlookReason | null => {
  if (firstMeasurementDate === null || firstMeasurementDate > startDate) {
    return 'first_measurement_too_recent'
  }
  if (recentPoints.length < WEIGHT_OUTLOOK_POLICY.minimumMeasurementDays) {
    return 'too_few_measurement_days'
  }
  const intervalCount =
    WEIGHT_OUTLOOK_POLICY.windowDays / WEIGHT_OUTLOOK_POLICY.daysPerWeek
  const weekCounts = Array.from({ length: intervalCount }, () => 0)
  for (const point of recentPoints) {
    const weekIndex = Math.floor(
      daysBetween(startDate, point.date) / WEIGHT_OUTLOOK_POLICY.daysPerWeek,
    )
    if (weekIndex >= 0 && weekIndex < weekCounts.length) {
      weekCounts[weekIndex] = (weekCounts[weekIndex] ?? 0) + 1
    }
  }
  if (
    weekCounts.some(
      (count) => count < WEIGHT_OUTLOOK_POLICY.minimumMeasurementsPerWeek,
    )
  ) {
    return 'measurement_gap'
  }
  return null
}

const regress = (
  points: ReadonlyArray<DailyPoint>,
  startDate: JstDate,
): Regression => {
  const pairs = points.map((point) => ({
    x: daysBetween(startDate, point.date),
    y: point.weightKg,
  }))
  const meanX = pairs.reduce((sum, point) => sum + point.x, 0) / pairs.length
  const meanY = pairs.reduce((sum, point) => sum + point.y, 0) / pairs.length
  const sumSquaredX = pairs.reduce(
    (sum, point) => sum + (point.x - meanX) ** 2,
    0,
  )
  const slope =
    pairs.reduce(
      (sum, point) => sum + (point.x - meanX) * (point.y - meanY),
      0,
    ) / sumSquaredX
  const intercept = meanY - slope * meanX
  const residualSumSquares = pairs.reduce(
    (sum, point) => sum + (point.y - (intercept + slope * point.x)) ** 2,
    0,
  )
  const degreesOfFreedom = pairs.length - 2
  const tCritical =
    Object.entries(
      WEIGHT_OUTLOOK_POLICY.tCriticalFor80PercentIntervalByDegreesOfFreedom,
    ).find(([degrees]) => Number(degrees) === degreesOfFreedom)?.[1] ?? 1.345
  return {
    slope,
    intercept,
    meanX,
    sumSquaredX,
    residualStandardError: Math.sqrt(residualSumSquares / degreesOfFreedom),
    tCritical,
  }
}

const getSlopeInterval = (
  regression: Regression,
): readonly [number, number] => {
  const standardError =
    regression.residualStandardError / Math.sqrt(regression.sumSquaredX)
  const margin = regression.tCritical * standardError
  return [regression.slope - margin, regression.slope + margin]
}

const comparisonTolerance = (value: number, target: number): number =>
  Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(target)) * 16

const isAtOrBelow = (value: number, target: number): boolean =>
  value <= target + comparisonTolerance(value, target)

const isAtOrAbove = (value: number, target: number): boolean =>
  value >= target - comparisonTolerance(value, target)

export const calculateWeightOutlook = (
  weights: ReadonlyArray<BodyWeight>,
  firstMeasurementDate: JstDate | null,
  asOf: JstDate,
  goalWeightKg: number | null,
): WeightOutlook => {
  const startDate = getWeightOutlookStartDate(asOf)
  const points = averageByDate(weights).filter(
    ({ date }) => date >= startDate && date <= asOf,
  )
  const shared = {
    asOf,
    points,
    latestWeightKg: points.at(-1)?.weightKg ?? null,
    goalWeightKg,
  }
  const reason = findInsufficientReason(firstMeasurementDate, points, startDate)
  if (reason !== null) {
    return {
      ...shared,
      trend: null,
      status: 'insufficient_data',
      reason,
      arrivalDateRange: null,
    }
  }

  const regression = regress(points, startDate)
  const slopeInterval = getSlopeInterval(regression)
  const trendPoints = Array.from(
    {
      length:
        WEIGHT_OUTLOOK_POLICY.windowDays + WEIGHT_OUTLOOK_POLICY.forecastDays,
    },
    (_, index) => {
      const x = index
      const weightKg = regression.intercept + regression.slope * x
      const standardError =
        regression.residualStandardError *
        Math.sqrt(
          1 / points.length +
            (x - regression.meanX) ** 2 / regression.sumSquaredX,
        )
      const margin = regression.tCritical * standardError
      return {
        date: shiftDate(startDate, x),
        weightKg,
        lowerKg: weightKg - margin,
        upperKg: weightKg + margin,
      }
    },
  )
  const trend = {
    slopeKgPerDay: regression.slope,
    slopeKgPerWeek: regression.slope * WEIGHT_OUTLOOK_POLICY.daysPerWeek,
    points: trendPoints,
  }
  if (goalWeightKg === null) {
    return {
      ...shared,
      trend,
      status: 'no_goal',
      reason: null,
      arrivalDateRange: null,
    }
  }

  const trendToday = trendPoints.find(({ date }) => date === asOf)
  const trendSixDaysAgo = trendPoints.find(
    ({ date }) =>
      date === shiftDate(asOf, -(WEIGHT_OUTLOOK_POLICY.daysPerWeek - 1)),
  )
  const trendAtWindowStart = trendPoints.find(({ date }) => date === startDate)
  if (
    trendToday === undefined ||
    trendSixDaysAgo === undefined ||
    trendAtWindowStart === undefined
  ) {
    return {
      ...shared,
      trend,
      status: 'no_arrival_estimate',
      reason: null,
      arrivalDateRange: null,
    }
  }
  const direction = isAtOrAbove(trendAtWindowStart.weightKg, goalWeightKg)
    ? -1
    : 1
  const hasReached =
    direction < 0
      ? isAtOrBelow(trendSixDaysAgo.weightKg, goalWeightKg) &&
        isAtOrBelow(trendToday.weightKg, goalWeightKg)
      : isAtOrAbove(trendSixDaysAgo.weightKg, goalWeightKg) &&
        isAtOrAbove(trendToday.weightKg, goalWeightKg)
  if (hasReached) {
    return {
      ...shared,
      trend,
      status: 'reached',
      reason: null,
      arrivalDateRange: null,
    }
  }

  const slopeIsTowardGoal =
    direction < 0 ? slopeInterval[1] < 0 : slopeInterval[0] > 0
  if (!slopeIsTowardGoal) {
    return {
      ...shared,
      trend,
      status: 'not_approaching',
      reason: null,
      arrivalDateRange: null,
    }
  }

  const favorableDate = trendPoints
    .slice(WEIGHT_OUTLOOK_POLICY.windowDays)
    .find(({ lowerKg, upperKg }) =>
      direction < 0
        ? isAtOrBelow(lowerKg, goalWeightKg)
        : isAtOrAbove(upperKg, goalWeightKg),
    )?.date
  const conservativeDate = trendPoints
    .slice(WEIGHT_OUTLOOK_POLICY.windowDays)
    .find(({ lowerKg, upperKg }) =>
      direction < 0
        ? isAtOrBelow(upperKg, goalWeightKg)
        : isAtOrAbove(lowerKg, goalWeightKg),
    )?.date
  if (favorableDate === undefined || conservativeDate === undefined) {
    return {
      ...shared,
      trend,
      status: 'no_arrival_estimate',
      reason: null,
      arrivalDateRange: null,
    }
  }
  return {
    ...shared,
    trend,
    status: 'arrival_estimate',
    reason: null,
    arrivalDateRange: { from: favorableDate, to: conservativeDate },
  }
}
