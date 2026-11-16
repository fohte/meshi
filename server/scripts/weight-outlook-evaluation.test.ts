import { describe, expect, it } from 'vitest'

import type { BodyWeight } from '#domain/body-weight/types'
import { jstDateSchema } from '#lib/jst-date'
import { evaluateWeightOutlook } from '#scripts/weight-outlook-evaluation'

const syntheticWeights = (count: number): BodyWeight[] => {
  const firstDate = Temporal.PlainDate.from('2025-01-01')
  return Array.from({ length: count }, (_, index) => {
    const date = jstDateSchema.parse(firstDate.add({ days: index }).toString())
    return {
      id: `synthetic-${String(index)}`,
      date,
      measuredAt: null,
      weightKg: 70 - index * 0.1,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      updatedAt: new Date('2025-01-01T00:00:00.000Z'),
    }
  })
}

describe('evaluateWeightOutlook', () => {
  it('scores daily trend and last-value forecasts in separate historical and validation periods', () => {
    expect(evaluateWeightOutlook(syntheticWeights(120))).toEqual({
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
})
