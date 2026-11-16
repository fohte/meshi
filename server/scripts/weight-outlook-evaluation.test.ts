import { describe, expect, it } from 'vitest'

import type { BodyWeight } from '#domain/body-weight/types'
import { jstDateSchema } from '#lib/jst-date'
import { evaluateWeightOutlook } from '#scripts/weight-outlook-evaluation'

const syntheticWeights = (
  count: number,
  weightAt: (index: number) => number = () => 70,
): BodyWeight[] => {
  const firstDate = Temporal.PlainDate.from('2025-01-01')
  return Array.from({ length: count }, (_, index) => {
    const date = jstDateSchema.parse(firstDate.add({ days: index }).toString())
    return {
      id: `synthetic-${String(index)}`,
      date,
      measuredAt: null,
      weightKg: weightAt(index),
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    }
  })
}

const emptyMetrics = {
  sampleCount: 0,
  maeKg: null,
  coverage: null,
  meanIntervalWidthKg: null,
  misses: 0,
}

const emptyHorizon = (daysAhead: 7 | 28 | 56 | 84) => ({
  daysAhead,
  nonOverlappingSampleCount: 0,
  trend: emptyMetrics,
  baseline: emptyMetrics,
})

const shortSeriesExpectedReport = (
  trend: {
    sampleCount: number
    maeKg: number | null
    coverage: number | null
    meanIntervalWidthKg: number | null
    misses: number
  },
  baseline: {
    sampleCount: number
    maeKg: number | null
    coverage: number | null
    meanIntervalWidthKg: number | null
    misses: number
  },
  nonOverlappingSampleCount: number,
) => ({
  firstMeasurementDate: '2025-01-01',
  lastMeasurementDate: '2025-01-30',
  validationStartDate: '2025-01-03',
  skippedInsufficientOrigins: 27,
  periods: [
    {
      name: 'historical',
      horizons: [
        {
          daysAhead: 1,
          nonOverlappingSampleCount: 0,
          trend: emptyMetrics,
          baseline: emptyMetrics,
        },
        emptyHorizon(7),
        emptyHorizon(28),
        emptyHorizon(56),
        emptyHorizon(84),
      ],
    },
    {
      name: 'validation',
      horizons: [
        {
          daysAhead: 1,
          nonOverlappingSampleCount,
          trend,
          baseline,
        },
        emptyHorizon(7),
        emptyHorizon(28),
        emptyHorizon(56),
        emptyHorizon(84),
      ],
    },
  ],
})

describe('evaluateWeightOutlook', () => {
  it('scores daily trend and last-value forecasts in separate historical and validation periods', () => {
    expect(
      evaluateWeightOutlook(syntheticWeights(120, (index) => 70 - index * 0.1)),
    ).toEqual({
      firstMeasurementDate: '2025-01-01',
      lastMeasurementDate: '2025-04-30',
      validationStartDate: '2025-04-03',
      skippedInsufficientOrigins: 27,
      periods: [
        {
          name: 'historical',
          horizons: [
            {
              daysAhead: 1,
              nonOverlappingSampleCount: 3,
              trend: {
                sampleCount: 64,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 64,
                maeKg: 0.1,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 64,
              },
            },
            {
              daysAhead: 7,
              nonOverlappingSampleCount: 3,
              trend: {
                sampleCount: 58,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 58,
                maeKg: 0.7,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 58,
              },
            },
            {
              daysAhead: 28,
              nonOverlappingSampleCount: 2,
              trend: {
                sampleCount: 37,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 37,
                maeKg: 2.8,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 37,
              },
            },
            {
              daysAhead: 56,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 9,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 9,
                maeKg: 5.6,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 9,
              },
            },
            {
              daysAhead: 84,
              nonOverlappingSampleCount: 0,
              trend: {
                sampleCount: 0,
                maeKg: null,
                coverage: null,
                meanIntervalWidthKg: null,
                misses: 0,
              },
              baseline: {
                sampleCount: 0,
                maeKg: null,
                coverage: null,
                meanIntervalWidthKg: null,
                misses: 0,
              },
            },
          ],
        },
        {
          name: 'validation',
          horizons: [
            {
              daysAhead: 1,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 28,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 28,
                maeKg: 0.1,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 28,
              },
            },
            {
              daysAhead: 7,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 28,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 28,
                maeKg: 0.7,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 28,
              },
            },
            {
              daysAhead: 28,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 28,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 28,
                maeKg: 2.8,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 28,
              },
            },
            {
              daysAhead: 56,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 28,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 28,
                maeKg: 5.6,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 28,
              },
            },
            {
              daysAhead: 84,
              nonOverlappingSampleCount: 1,
              trend: {
                sampleCount: 9,
                maeKg: 0,
                coverage: 1,
                meanIntervalWidthKg: 0,
                misses: 0,
              },
              baseline: {
                sampleCount: 9,
                maeKg: 8.4,
                coverage: 0,
                meanIntervalWidthKg: 0,
                misses: 9,
              },
            },
          ],
        },
      ],
    })
  })

  it('reports a non-zero interval and partial coverage for a noisy series', () => {
    const weights = syntheticWeights(30, (index) =>
      index < 28 ? (index % 2 === 0 ? 70 : 72) : index === 28 ? 71 : 75,
    )

    expect(evaluateWeightOutlook(weights)).toEqual(
      shortSeriesExpectedReport(
        {
          sampleCount: 2,
          maeKg: 2.04,
          coverage: 0.5,
          meanIntervalWidthKg: 1.049,
          misses: 1,
        },
        {
          sampleCount: 2,
          maeKg: 2.5,
          coverage: 0,
          meanIntervalWidthKg: 1.049,
          misses: 2,
        },
        1,
      ),
    )
  })

  it('skips targets that have no measurement on the forecast date', () => {
    const missingTargetDate = jstDateSchema.parse(
      Temporal.PlainDate.from('2025-01-01').add({ days: 28 }).toString(),
    )
    const weights = syntheticWeights(30, (index) =>
      index < 28 ? (index % 2 === 0 ? 70 : 72) : index === 28 ? 71 : 75,
    ).filter(({ date }) => date !== missingTargetDate)

    expect(evaluateWeightOutlook(weights)).toEqual(
      shortSeriesExpectedReport(
        {
          sampleCount: 1,
          maeKg: 3.963,
          coverage: 0,
          meanIntervalWidthKg: 1.141,
          misses: 1,
        },
        {
          sampleCount: 1,
          maeKg: 3,
          coverage: 0,
          meanIntervalWidthKg: 1.141,
          misses: 1,
        },
        1,
      ),
    )
  })
})
