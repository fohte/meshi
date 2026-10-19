import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import {
  receiveStockDelivery,
  registerStockDelivery,
  StockDeliveryRequestError,
} from '#api/stock-deliveries'

const DELIVERY = {
  id: 'delivery_example',
  sourceRef: 'order_example_42',
  status: 'planned',
  expectedDate: '2026-11-14',
  receivedDate: null,
  changeDeadline: '2026-11-10',
  items: [
    {
      foodMasterId: 'food_example_oats',
      foodName: '架空オーツ',
      quantity: 2,
    },
  ],
}

const mockFetch = (body: unknown, status = 200): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const readResult = (
  result: Awaited<ReturnType<typeof registerStockDelivery>>,
) =>
  result.match(
    (value) => ({ ok: true, value }),
    (error) => ({
      ok: false,
      name: error.name,
      message: error.message,
      status:
        error instanceof StockDeliveryRequestError ? error.status : undefined,
    }),
  )

const readRequestResult = (
  fetchMock: ReturnType<typeof vi.fn>,
  result: Awaited<ReturnType<typeof registerStockDelivery>>,
) => ({ calls: fetchMock.mock.calls, result: readResult(result) })

const readInvalidResponseResult = (
  result: Awaited<ReturnType<typeof registerStockDelivery>>,
) => ({
  ...readResult(result),
  isApiError: result.isErr() && result.error instanceof ApiRequestError,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('registerStockDelivery', () => {
  it('posts the order number and returns the complete validated delivery', async () => {
    const fetchMock = mockFetch(DELIVERY)
    const input = {
      sourceRef: 'order_example_42',
      status: 'planned' as const,
      expectedDate: '2026-11-14',
      changeDeadline: '2026-11-10',
      items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
    }

    const result = await registerStockDelivery(input)

    expect(readRequestResult(fetchMock, result)).toEqual({
      calls: [
        [
          '/api/stock/deliveries',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        ],
      ],
      result: { ok: true, value: DELIVERY },
    })
  })

  it('preserves the conflict status and server message', async () => {
    mockFetch({ error: 'delivery is no longer planned' }, 409)

    const result = await registerStockDelivery({
      sourceRef: 'order_example_42',
      status: 'cancelled',
      expectedDate: '2026-11-14',
      items: [],
    })

    expect(readResult(result)).toEqual({
      ok: false,
      name: 'StockDeliveryRequestError',
      message: 'delivery is no longer planned',
      status: 409,
    })
  })

  it('returns an ApiRequestError when a response has an invalid nested item', async () => {
    mockFetch({
      ...DELIVERY,
      items: [{ ...DELIVERY.items[0], quantity: 'two' }],
    })

    const result = await registerStockDelivery({
      sourceRef: 'order_example_42',
      status: 'planned',
      expectedDate: '2026-11-14',
      items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
    })

    expect(readInvalidResponseResult(result)).toEqual({
      ok: false,
      name: 'ApiRequestError',
      message:
        '/api/stock/deliveries response did not match the expected schema',
      status: undefined,
      isApiError: true,
    })
  })
})

describe('receiveStockDelivery', () => {
  it('encodes the delivery ID and sends actual quantities including zero', async () => {
    const received = {
      ...DELIVERY,
      status: 'received',
      receivedDate: '2026-11-15',
      items: [{ ...DELIVERY.items[0], quantity: 0 }],
    }
    const fetchMock = mockFetch(received)
    const input = {
      receivedDate: '2026-11-15',
      items: [{ foodMasterId: 'food_example_oats', quantity: 0 }],
    }

    const result = await receiveStockDelivery('delivery/example', input)

    expect(readRequestResult(fetchMock, result)).toEqual({
      calls: [
        [
          '/api/stock/deliveries/delivery%2Fexample/receive',
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(input),
          },
        ],
      ],
      result: { ok: true, value: received },
    })
  })
})
