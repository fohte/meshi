import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import { postStockCount } from '#api/stock-counts'

const COUNT_RESULT = {
  foodMasterId: 'food_example_lentils',
  previousQuantity: 1,
  countedQuantity: 0.75,
  difference: -0.25,
}

const mockFetch = (response: Response): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue(response)
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const errorSnapshot = (error: ApiRequestError) => ({
  name: error.name,
  message: error.message,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('postStockCount', () => {
  it('posts an absolute fractional count with the optional dates', async () => {
    const fetchMock = mockFetch(
      new Response(JSON.stringify(COUNT_RESULT), { status: 200 }),
    )
    const input = {
      foodMasterId: 'food_example_lentils',
      quantity: 0.75,
      receivedDate: '2026-08-12',
      bestBefore: '2026-09-20',
    }
    const result = await postStockCount(input)

    const actual = await result.match(
      (value) =>
        Promise.resolve({ calls: fetchMock.mock.calls, result: value }),
      (error) =>
        Promise.resolve({
          calls: fetchMock.mock.calls,
          error: errorSnapshot(error),
        }),
    )
    expect(actual).toEqual({
      calls: [
        [
          '/api/stock/counts',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        ],
      ],
      result: COUNT_RESULT,
    })
  })

  it('rejects a successful response that does not match the result schema', async () => {
    mockFetch(
      new Response(JSON.stringify({ foodMasterId: 'food_example_lentils' }), {
        status: 200,
      }),
    )

    const result = await postStockCount({
      foodMasterId: 'food_example_lentils',
      quantity: 0.75,
    })

    expect(errorSnapshot(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: '/api/stock/counts response did not match the expected schema',
    })
  })

  it('shows the server error message for a failed count', async () => {
    mockFetch(
      new Response(JSON.stringify({ error: 'stock item not found' }), {
        status: 404,
      }),
    )

    const result = await postStockCount({
      foodMasterId: 'food_example_missing',
      quantity: 0,
    })

    expect(errorSnapshot(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: 'stock item not found',
    })
  })

  it('uses the status fallback when the error response is not JSON', async () => {
    mockFetch(new Response('upstream unavailable', { status: 502 }))

    const result = await postStockCount({
      foodMasterId: 'food_example_lentils',
      quantity: 0,
    })

    expect(errorSnapshot(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: '/api/stock/counts responded with 502',
    })
  })
})
