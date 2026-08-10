import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerFoodMasterFromComposition } from '#api/food-masters'

const mockFetchOk = (body: unknown): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registerFoodMasterFromComposition', () => {
  it('posts the composition code and resolves with the registered food_master', async () => {
    const body = {
      id: 'fm_new',
      name: 'そば ゆで',
      isEstimated: true,
      source: 'composition_table_estimate',
      sourceUrl: null,
      nutrition: { energy_kcal: 130 },
    }
    const fetchMock = mockFetchOk(body)

    const result = await registerFoodMasterFromComposition('01088')

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/food-masters/from-composition',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ compositionCode: '01088' }),
      },
    )
    expect(result._unsafeUnwrap()).toEqual(body)
  })
})
