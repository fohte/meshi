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
    })

    await fetchMealHistory('2026-07-01', '2026-07-08')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/meal-history?from=2026-07-01&to=2026-07-08',
      undefined,
    )
  })

  it('resolves with the parsed aggregate', async () => {
    mockFetchOk({
      totals: { energy_kcal: 100 },
      perDay: [{ date: '2026-07-29', totals: { energy_kcal: 100 } }],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'fm_rice',
          foodName: 'rice',
          eatenAt: '2026-07-29T03:00:00.000Z',
          mealType: 'breakfast',
          quantity: 100,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })

    const result = await fetchMealHistory('2026-07-29', '2026-07-30')

    expect(result._unsafeUnwrap()).toEqual({
      totals: { energy_kcal: 100 },
      perDay: [{ date: '2026-07-29', totals: { energy_kcal: 100 } }],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'fm_rice',
          foodName: 'rice',
          eatenAt: '2026-07-29T03:00:00.000Z',
          mealType: 'breakfast',
          quantity: 100,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })
  })
})
