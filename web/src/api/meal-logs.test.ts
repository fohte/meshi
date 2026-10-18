import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import {
  BatchMealLogRequestError,
  deleteMealLog,
  patchMealLog,
  postMealLog,
  postMealLogs,
} from '#api/meal-logs'

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

describe('postMealLog', () => {
  it('posts to /api/meal-logs with a JSON body and resolves with the result', async () => {
    const fetchMock = mockFetchOk(SAMPLE_JSON)

    const result = await postMealLog({
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

describe('postMealLogs', () => {
  it('posts a batch and parses the result array', async () => {
    const fetchMock = mockFetchOk([SAMPLE_JSON])
    const input = {
      eatenDate: '2026-07-29',
      mealType: 'breakfast' as const,
      items: [
        { foodMasterId: 'fm_demo_alpha', quantity: 1.5 },
        { foodMasterId: 'fm_demo_beta', quantity: 2 },
      ],
    }

    const result = await postMealLogs(input)

    const snapshot = () => ({
      request: fetchMock.mock.calls,
      result: result._unsafeUnwrap(),
    })

    expect(snapshot()).toEqual({
      request: [
        [
          '/api/meal-logs',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        ],
      ],
      result: [SAMPLE_JSON],
    })
  })

  it('preserves the invalid item index from a batch error response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({
            error: 'invalid quantity',
            itemIndex: 2,
          }),
      }),
    )

    const result = await postMealLogs({
      eatenDate: '2026-07-29',
      mealType: 'breakfast',
      items: [{ foodMasterId: 'fm_demo_alpha', quantity: 1 }],
    })
    const error = result._unsafeUnwrapErr()

    const snapshot = () => ({
      name: error.name,
      message: error.message,
      itemIndex:
        error instanceof BatchMealLogRequestError ? error.itemIndex : null,
    })

    expect(snapshot()).toEqual({
      name: 'BatchMealLogRequestError',
      message: 'invalid quantity',
      itemIndex: 2,
    })
  })

  it('rejects an error response that does not match the schema', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: () =>
          Promise.resolve({ error: 'invalid quantity', itemIndex: 'second' }),
      }),
    )

    const result = await postMealLogs({
      eatenDate: '2026-07-29',
      mealType: 'breakfast',
      items: [{ foodMasterId: 'fm_demo_alpha', quantity: 1 }],
    })
    const error = result._unsafeUnwrapErr()

    const snapshot = () => ({
      name: error.name,
      message: error.message,
      itemIndex:
        error instanceof BatchMealLogRequestError ? error.itemIndex : null,
    })

    expect(snapshot()).toEqual({
      name: 'ApiRequestError',
      message: '/api/meal-logs responded with 400',
      itemIndex: null,
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
