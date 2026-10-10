import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchDayDetail } from '#api/day-detail'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchDayDetail', () => {
  it('parses an unknown-nutrition entry with nullable kcal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            date: '2026-07-29',
            totals: {},
            hasEstimatedValues: false,
            hasUnknownValues: true,
            skippedMealTypes: [],
            entries: [
              {
                id: 'ml_unknown',
                foodMasterId: 'fm_unknown',
                foodName: 'unknown menu',
                eatenDate: '2026-07-29',
                mealType: 'dinner',
                quantity: 1,
                kcal: null,
                isEstimated: false,
                nutritionStatus: 'unknown',
              },
            ],
          }),
      }),
    )

    const result = await fetchDayDetail('2026-07-29')

    expect(result._unsafeUnwrap()).toEqual({
      date: '2026-07-29',
      totals: {},
      hasEstimatedValues: false,
      hasUnknownValues: true,
      skippedMealTypes: [],
      entries: [
        {
          id: 'ml_unknown',
          foodMasterId: 'fm_unknown',
          foodName: 'unknown menu',
          eatenDate: '2026-07-29',
          mealType: 'dinner',
          quantity: 1,
          kcal: null,
          isEstimated: false,
          nutritionStatus: 'unknown',
        },
      ],
    })
  })
})
