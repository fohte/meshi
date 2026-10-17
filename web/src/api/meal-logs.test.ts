import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import { deleteMealLog, mealLogsApi, patchMealLog } from '#api/meal-logs'

const mockFetchOk = (body: unknown): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const requestSnapshot = (
  fetchMock: ReturnType<typeof vi.fn>,
  result: unknown,
) => ({
  calls: fetchMock.mock.calls,
  result,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_JSON = {
  id: 'ml_1',
  foodMasterId: 'fm_unknown',
  eatenDate: '2026-07-29',
  mealType: 'breakfast',
  quantity: 150,
  nutrition: {},
  isEstimated: false,
  nutritionStatus: 'unknown',
  createdAt: '2026-07-29T03:00:01.000Z',
}

describe('mealLogsApi.postMealLog', () => {
  it('posts to /api/meal-logs with a JSON body and resolves with the result', async () => {
    const fetchMock = mockFetchOk(SAMPLE_JSON)

    const result = await mealLogsApi.postMealLog({
      foodMasterId: 'fm_unknown',
      eatenDate: '2026-07-29',
      mealType: 'breakfast',
      quantity: 150,
    })

    expect(fetchMock).toHaveBeenCalledWith('/api/meal-logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        foodMasterId: 'fm_unknown',
        eatenDate: '2026-07-29',
        mealType: 'breakfast',
        quantity: 150,
      }),
    })
    expect(result._unsafeUnwrap()).toEqual(SAMPLE_JSON)
  })
})

describe('mealLogsApi.postMealLogs', () => {
  it('posts multiple meal logs and resolves with the result array', async () => {
    const secondResult = {
      ...SAMPLE_JSON,
      id: 'ml_2',
      foodMasterId: 'fm_oats',
      quantity: 50,
    }
    const fetchMock = mockFetchOk([SAMPLE_JSON, secondResult])

    const result = await mealLogsApi.postMealLogs({
      eatenDate: '2026-07-29',
      mealType: 'breakfast',
      items: [
        { foodMasterId: 'fm_unknown', quantity: 150 },
        { foodMasterId: 'fm_oats', quantity: 50 },
      ],
    })

    expect(requestSnapshot(fetchMock, result._unsafeUnwrap())).toEqual({
      calls: [
        [
          '/api/meal-logs',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              eatenDate: '2026-07-29',
              mealType: 'breakfast',
              items: [
                { foodMasterId: 'fm_unknown', quantity: 150 },
                { foodMasterId: 'fm_oats', quantity: 50 },
              ],
            }),
          },
        ],
      ],
      result: [SAMPLE_JSON, secondResult],
    })
  })
})

describe('patchMealLog', () => {
  it('patches /api/meal-logs/:id with a JSON body and resolves with the result', async () => {
    const fetchMock = mockFetchOk(SAMPLE_JSON)

    const result = await patchMealLog('ml_1', { quantity: 200 })

    expect(fetchMock).toHaveBeenCalledWith('/api/meal-logs/ml_1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ quantity: 200 }),
    })
    expect(result._unsafeUnwrap()).toEqual(SAMPLE_JSON)
  })
})

describe('deleteMealLog', () => {
  it('resolves with undefined on a 204 response', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteMealLog('ml_1')

    expect(fetchMock).toHaveBeenCalledWith('/api/meal-logs/ml_1', {
      method: 'DELETE',
    })
    expect(result.isOk()).toBe(true)
  })

  it('fails with an ApiRequestError on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 404 }),
    )

    const result = await deleteMealLog('ml_missing')

    expect(result._unsafeUnwrapErr()).toBeInstanceOf(ApiRequestError)
  })
})
