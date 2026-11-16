import type { BodyWeight } from '#domain/body-weight/types'
import {
  calculateWeightOutlook,
  getWeightOutlookStartDate,
} from '#domain/weight-outlook/weight-outlook-calculator'
import { averageWeightOutlookMeasurementsByDate } from '#domain/weight-outlook/weight-outlook-daily-points'
import { type JstDate, jstDateSchema } from '#lib/jst-date'
import {
  summarizeWeightOutlookForecasts,
  type WeightOutlookForecastResult,
} from '#scripts/weight-outlook-evaluation-metrics'

const WEIGHT_OUTLOOK_EVALUATION_HORIZONS = [1, 7, 28, 56, 84] as const

type ForecastHorizon = (typeof WEIGHT_OUTLOOK_EVALUATION_HORIZONS)[number]
type ForecastKind = 'trend' | 'baseline'
type EvaluationPeriodName = 'historical' | 'validation'

interface WeightOutlookEvaluationReport {
  readonly firstMeasurementDate: JstDate | null
  readonly lastMeasurementDate: JstDate | null
  readonly validationStartDate: JstDate | null
  readonly skippedInsufficientOrigins: number
  readonly periods: ReadonlyArray<{
    readonly name: EvaluationPeriodName
    readonly horizons: ReadonlyArray<{
      readonly daysAhead: ForecastHorizon
      readonly trend: ReturnType<typeof summarizeWeightOutlookForecasts>
      readonly baseline: ReturnType<typeof summarizeWeightOutlookForecasts>
    }>
  }>
}

const shiftDate = (date: JstDate, days: number): JstDate =>
  jstDateSchema.parse(Temporal.PlainDate.from(date).add({ days }).toString())

export const evaluateWeightOutlook = (
  weights: ReadonlyArray<BodyWeight>,
): WeightOutlookEvaluationReport => {
  const dailyWeights = averageWeightOutlookMeasurementsByDate(weights)
  const firstMeasurementDate = dailyWeights[0]?.date ?? null
  const lastMeasurementDate = dailyWeights.at(-1)?.date ?? null
  const validationStartDate =
    lastMeasurementDate === null ? null : shiftDate(lastMeasurementDate, -27)
  const dailyByDate = new Map(
    dailyWeights.map(({ date, weightKg }) => [date, weightKg]),
  )
  const measurementsByDate = new Map<JstDate, BodyWeight[]>()
  for (const weight of weights) {
    const measurements = measurementsByDate.get(weight.date) ?? []
    measurements.push(weight)
    measurementsByDate.set(weight.date, measurements)
  }
  const results = new Map<
    EvaluationPeriodName,
    Map<ForecastHorizon, Map<ForecastKind, WeightOutlookForecastResult[]>>
  >(
    (['historical', 'validation'] as const).map((period) => [
      period,
      new Map(
        WEIGHT_OUTLOOK_EVALUATION_HORIZONS.map((horizon) => [
          horizon,
          new Map<ForecastKind, WeightOutlookForecastResult[]>([
            ['trend', []],
            ['baseline', []],
          ]),
        ]),
      ),
    ]),
  )

  let skippedInsufficientOrigins = 0
  if (firstMeasurementDate !== null && lastMeasurementDate !== null) {
    for (
      let originDate = firstMeasurementDate;
      originDate <= lastMeasurementDate;
      originDate = shiftDate(originDate, 1)
    ) {
      const startDate = getWeightOutlookStartDate(originDate)
      const history: BodyWeight[] = []
      for (
        let historyDate = startDate;
        historyDate <= originDate;
        historyDate = shiftDate(historyDate, 1)
      ) {
        history.push(...(measurementsByDate.get(historyDate) ?? []))
      }
      const outlook = calculateWeightOutlook(
        history,
        firstMeasurementDate,
        originDate,
        null,
      )
      if (outlook.trend === null || outlook.latestWeightKg === null) {
        skippedInsufficientOrigins += 1
        continue
      }

      for (const daysAhead of WEIGHT_OUTLOOK_EVALUATION_HORIZONS) {
        const targetDate = shiftDate(originDate, daysAhead)
        const actualKg = dailyByDate.get(targetDate)
        if (actualKg === undefined) continue

        const trendPoint = outlook.trend.points.find(
          ({ date }) => date === targetDate,
        )
        if (trendPoint === undefined) continue

        const period: EvaluationPeriodName =
          validationStartDate !== null && targetDate >= validationStartDate
            ? 'validation'
            : 'historical'
        const periodResults = results.get(period)
        const horizonResults = periodResults?.get(daysAhead)
        const trendResults = horizonResults?.get('trend')
        const baselineResults = horizonResults?.get('baseline')
        if (
          periodResults === undefined ||
          horizonResults === undefined ||
          trendResults === undefined ||
          baselineResults === undefined
        ) {
          continue
        }

        trendResults.push({
          actualKg,
          predictedKg: trendPoint.weightKg,
          lowerKg: trendPoint.lowerKg,
          upperKg: trendPoint.upperKg,
        })

        const intervalHalfWidth = (trendPoint.upperKg - trendPoint.lowerKg) / 2
        baselineResults.push({
          actualKg,
          predictedKg: outlook.latestWeightKg,
          lowerKg: outlook.latestWeightKg - intervalHalfWidth,
          upperKg: outlook.latestWeightKg + intervalHalfWidth,
        })
      }
    }
  }

  return {
    firstMeasurementDate,
    lastMeasurementDate,
    validationStartDate,
    skippedInsufficientOrigins,
    periods: (['historical', 'validation'] as const).map((name) => ({
      name,
      horizons: WEIGHT_OUTLOOK_EVALUATION_HORIZONS.map((daysAhead) => {
        const horizonResults = results.get(name)?.get(daysAhead)
        return {
          daysAhead,
          trend: summarizeWeightOutlookForecasts(
            horizonResults?.get('trend') ?? [],
          ),
          baseline: summarizeWeightOutlookForecasts(
            horizonResults?.get('baseline') ?? [],
          ),
        }
      }),
    })),
  }
}
