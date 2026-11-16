export interface WeightOutlookForecastResult {
  readonly actualKg: number
  readonly predictedKg: number
  readonly lowerKg: number
  readonly upperKg: number
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
  const coveredCount = forecasts.filter(
    ({ actualKg, lowerKg, upperKg }) =>
      actualKg >= lowerKg && actualKg <= upperKg,
  ).length
  const intervalWidthTotal = forecasts.reduce(
    (total, { lowerKg, upperKg }) => total + (upperKg - lowerKg),
    0,
  )

  return {
    sampleCount: forecasts.length,
    maeKg: absoluteErrorTotal / forecasts.length,
    coverage: coveredCount / forecasts.length,
    meanIntervalWidthKg: intervalWidthTotal / forecasts.length,
    misses: forecasts.length - coveredCount,
  }
}
