export interface WeightOutlookForecastResult {
  readonly actualKg: number
  readonly predictedKg: number
  readonly lowerKg: number
  readonly upperKg: number
}

const roundToThreeDecimalPlaces = (value: number): number =>
  Math.round(value * 1000) / 1000

const isCovered = ({
  actualKg,
  lowerKg,
  upperKg,
}: WeightOutlookForecastResult) => {
  const tolerance =
    Number.EPSILON *
    Math.max(1, Math.abs(actualKg), Math.abs(lowerKg), Math.abs(upperKg)) *
    16
  return actualKg >= lowerKg - tolerance && actualKg <= upperKg + tolerance
}

export const summarizeWeightOutlookForecasts = (
  forecasts: ReadonlyArray<WeightOutlookForecastResult>,
) => {
  if (forecasts.length === 0) {
    return {
      sampleCount: 0,
      maeKg: null,
      coverage: null,
      meanIntervalWidthKg: null,
      misses: 0,
    }
  }

  const absoluteErrorTotal = forecasts.reduce(
    (total, forecast) =>
      total + Math.abs(forecast.actualKg - forecast.predictedKg),
    0,
  )
  const coveredCount = forecasts.filter(isCovered).length
  const intervalWidthTotal = forecasts.reduce(
    (total, { lowerKg, upperKg }) => total + (upperKg - lowerKg),
    0,
  )

  return {
    sampleCount: forecasts.length,
    maeKg: roundToThreeDecimalPlaces(absoluteErrorTotal / forecasts.length),
    coverage: roundToThreeDecimalPlaces(coveredCount / forecasts.length),
    meanIntervalWidthKg: roundToThreeDecimalPlaces(
      intervalWidthTotal / forecasts.length,
    ),
    misses: forecasts.length - coveredCount,
  }
}
