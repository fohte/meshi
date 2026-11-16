import { describe, expect, it } from 'vitest'

import { summarizeWeightOutlookForecasts } from '#scripts/weight-outlook-evaluation-metrics'

describe('summarizeWeightOutlookForecasts', () => {
  it('computes error, coverage, interval width, and missed intervals', () => {
    expect(
      summarizeWeightOutlookForecasts([
        { actualKg: 72, predictedKg: 70, lowerKg: 69, upperKg: 71 },
        { actualKg: 70, predictedKg: 70, lowerKg: 69, upperKg: 71 },
        { actualKg: 71, predictedKg: 70, lowerKg: 70, upperKg: 72 },
      ]),
    ).toEqual({
      sampleCount: 3,
      maeKg: 1,
      coverage: 0.667,
      meanIntervalWidthKg: 2,
      misses: 1,
    })
  })

  it('returns empty metrics when there are no observed targets', () => {
    expect(summarizeWeightOutlookForecasts([])).toEqual({
      sampleCount: 0,
      maeKg: null,
      coverage: null,
      meanIntervalWidthKg: null,
      misses: 0,
    })
  })
})
