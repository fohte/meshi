import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchMealHistory } from '#api/meal-history'

const mockFetchOk = (body: unknown): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchMealHistory', () => {
  it('requests /api/meal-history with from and to as query params', async () => {
    const fetchMock = mockFetchOk({
      totals: {},
      perDay: [],
      entries: [],
      hasEstimatedValues: false,
      hasUnknownValues: false,
    })

    await fetchMealHistory('2026-07-01', '2026-07-08')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meal-history?from=2026-07-01&to=2026-07-08',
      undefined,
    )
  })

  it('resolves with the parsed aggregate', async () => {
    mockFetchOk({
      totals: {},
      perDay: [
        {
          date: '2026-07-29',
          totals: {},
          hasUnknownValues: true,
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'fm_unknown',
          foodName: 'unknown food',
          eatenDate: '2026-07-29',
          mealType: 'breakfast',
          quantity: 100,
          nutritionStatus: 'unknown',
        },
      ],
      hasEstimatedValues: false,
      hasUnknownValues: true,
    })

    const result = await fetchMealHistory('2026-07-29', '2026-07-30')

    expect(result._unsafeUnwrap()).toEqual({
      totals: {},
      perDay: [
        {
          date: '2026-07-29',
          totals: {},
          hasUnknownValues: true,
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'fm_unknown',
          foodName: 'unknown food',
          eatenDate: '2026-07-29',
          mealType: 'breakfast',
          quantity: 100,
          nutritionStatus: 'unknown',
        },
      ],
      hasEstimatedValues: false,
      hasUnknownValues: true,
    })
  })
})
