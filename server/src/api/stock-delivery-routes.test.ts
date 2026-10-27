import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountStockDeliveryRoutes } from '#api/stock-delivery-routes'
import { StockDomainError } from '#domain/stock/errors'
import type {
  Delivery,
  ReceiveDeliveryInput,
  RegisterDeliveryInput,
  StockService,
} from '#domain/stock/types'
import { createStubApiDeps } from '#test/api-stubs'

const DELIVERY: Delivery = {
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

const buildApp = (stockService: StockService): Hono => {
  const app = new Hono()
  mountStockDeliveryRoutes(app, stockService)
  return app
}

const responseSnapshot = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
})

const responseWithCalls = async (
  res: Response,
  calls: ReadonlyArray<unknown>,
) => ({ ...(await responseSnapshot(res)), calls })

describe('POST /api/stock/deliveries', () => {
  it('registers a delivery and returns the complete camelCase result', async () => {
    const calls: Array<RegisterDeliveryInput> = []
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: (input) => {
        calls.push(input)
        return okAsync(DELIVERY)
      },
    })
    const input: RegisterDeliveryInput = {
      sourceRef: 'order_example_42',
      status: 'planned',
      expectedDate: '2026-11-14',
      changeDeadline: '2026-11-10',
      items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
    }

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(await responseWithCalls(res, calls)).toEqual({
      status: 200,
      body: DELIVERY,
      calls: [input],
    })
  })

  it('rejects an order number that is missing or empty', async () => {
    const app = buildApp(createStubApiDeps().stockService)

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        status: 'planned',
        expectedDate: '2026-11-14',
        items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
      }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'Invalid input: expected string, received undefined' },
    })
  })

  it('maps domain validation errors to bad requests', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: () =>
        errAsync(
          new StockDomainError('invalid_input', 'quantity must be positive'),
        ),
    })

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceRef: 'order_example_42',
        status: 'planned',
        expectedDate: '2026-11-14',
        items: [{ foodMasterId: 'food_example_oats', quantity: 0 }],
      }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'quantity must be positive' },
    })
  })

  it('maps unknown targets to not found', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: () =>
        errAsync(new StockDomainError('food_master_not_found', 'food missing')),
    })
    const input = {
      sourceRef: 'order_example_42',
      status: 'planned',
      expectedDate: '2026-11-14',
      items: [{ foodMasterId: 'food_example_missing', quantity: 2 }],
    }

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: 'food missing' },
    })
  })

  it('maps unmanaged stock items to not found', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: () =>
        errAsync(
          new StockDomainError(
            'stock_item_not_found',
            'food_master is not a stock_item',
          ),
        ),
    })

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceRef: 'order_example_44',
        status: 'planned',
        expectedDate: '2026-11-14',
        items: [{ foodMasterId: 'food_example_untracked', quantity: 2 }],
      }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: 'food_master is not a stock_item' },
    })
  })

  it('returns an internal server error when delivery persistence fails', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: () =>
        errAsync(
          new StockDomainError('persistence_failed', 'delivery unavailable'),
        ),
    })

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        sourceRef: 'order_example_42',
        status: 'planned',
        expectedDate: '2026-11-14',
        items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
      }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 500,
      body: { error: 'delivery unavailable' },
    })
  })

  it('returns a conflict when the source reference is already claimed', async () => {
    const calls: Array<RegisterDeliveryInput> = []
    const app = buildApp({
      ...createStubApiDeps().stockService,
      registerDelivery: (input) => {
        calls.push(input)
        return errAsync(
          new StockDomainError(
            'delivery_source_ref_conflict',
            'source reference is already claimed',
          ),
        )
      },
    })
    const input: RegisterDeliveryInput = {
      sourceRef: 'order_example_43',
      status: 'planned',
      expectedDate: '2026-11-14',
      items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
    }

    const res = await app.request('/api/stock/deliveries', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })

    expect(await responseWithCalls(res, calls)).toEqual({
      status: 409,
      body: { error: 'source reference is already claimed' },
      calls: [input],
    })
  })
})

describe('POST /api/stock/deliveries/:id/receive', () => {
  it('receives the delivery with actual quantities and returns the full result', async () => {
    const calls: Array<ReceiveDeliveryInput> = []
    const received: Delivery = {
      ...DELIVERY,
      status: 'received',
      receivedDate: '2026-11-15',
      items: [
        {
          foodMasterId: 'food_example_oats',
          foodName: '架空オーツ',
          quantity: 0,
        },
      ],
    }
    const app = buildApp({
      ...createStubApiDeps().stockService,
      receiveDelivery: (input) => {
        calls.push(input)
        return okAsync(received)
      },
    })
    const body = {
      receivedDate: '2026-11-15',
      items: [{ foodMasterId: 'food_example_oats', quantity: 0 }],
    }

    const res = await app.request(
      '/api/stock/deliveries/delivery_example/receive',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      },
    )

    expect(await responseWithCalls(res, calls)).toEqual({
      status: 200,
      body: received,
      calls: [
        {
          deliveryId: 'delivery_example',
          ...body,
        },
      ],
    })
  })

  it('returns a conflict when the delivery is no longer planned', async () => {
    const calls: Array<ReceiveDeliveryInput> = []
    const app = buildApp({
      ...createStubApiDeps().stockService,
      receiveDelivery: (input) => {
        calls.push(input)
        return errAsync(
          new StockDomainError(
            'delivery_not_planned',
            'delivery is no longer planned',
          ),
        )
      },
    })

    const res = await app.request(
      '/api/stock/deliveries/delivery_example/receive',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ receivedDate: '2026-11-15' }),
      },
    )

    expect(await responseWithCalls(res, calls)).toEqual({
      status: 409,
      body: { error: 'delivery is no longer planned' },
      calls: [{ deliveryId: 'delivery_example', receivedDate: '2026-11-15' }],
    })
  })
})
