import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  fetchFoodDetail,
  fetchFoodSearch,
  fetchFoodSuggestions,
  FoodNotFoundError,
} from '#api/foods'

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

describe('fetchFoodSearch', () => {
  it('requests /api/foods/search with q and limit as query params', async () => {
    const fetchMock = mockFetchOk({ items: [] })

    await fetchFoodSearch('rice', 10)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/foods/search?q=rice&limit=10',
      undefined,
    )
  })

  it('resolves with the response items', async () => {
    const item = {
      foodMasterId: 'fm_1',
      compositionCode: null,
      name: 'rice',
      isEstimated: false,
      reason: 'fuzzy_name',
      source: 'user_input',
      energyKcalPer100g: 168,
    }
    mockFetchOk({ items: [item] })

    const result = await fetchFoodSearch('rice', 10)

    expect(result._unsafeUnwrap()).toEqual([item])
  })
})

describe('fetchFoodSuggestions', () => {
  it('requests /api/foods/suggestions with limit as a query param', async () => {
    const fetchMock = mockFetchOk({ recent: [], frequent: [] })

    await fetchFoodSuggestions(5)

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/foods/suggestions?limit=5',
      undefined,
    )
  })
})

describe('fetchFoodDetail', () => {
  it('resolves with the parsed detail, converting eatenAt to a Date', async () => {
    mockFetchOk({
      id: 'fm_1',
      name: 'rice',
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      aliases: [],
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 168 },
      totalEatenCount: 1,
      history: [
        {
          id: 'ml_1',
          eatenAt: '2026-07-29T03:00:00.000Z',
          mealType: 'breakfast',
          amountGrams: 100,
          quantity: 100,
          unit: 'g',
        },
      ],
    })

    const result = await fetchFoodDetail('fm_1')

    expect(result._unsafeUnwrap()).toEqual({
      id: 'fm_1',
      name: 'rice',
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      aliases: [],
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 168 },
      totalEatenCount: 1,
      history: [
        {
          id: 'ml_1',
          eatenAt: new Date('2026-07-29T03:00:00.000Z'),
          mealType: 'breakfast',
          amountGrams: 100,
          quantity: 100,
          unit: 'g',
        },
      ],
    })
  })

  it('fails with FoodNotFoundError on a 404 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: 'food not found' }),
      }),
    )

    const result = await fetchFoodDetail('fm_missing')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(FoodNotFoundError)
  })
})
