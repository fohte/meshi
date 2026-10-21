import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { mountStockRoutes } from '#api/stock-routes'
import { StockDomainError } from '#domain/stock/errors'
import type { StockService, StockStatus } from '#domain/stock/types'
import { createStubApiDeps } from '#test/api-stubs'

const SAMPLE_STOCK_STATUS: StockStatus = {
  stockItems: [
    {
      foodMasterId: 'food_example_beans',
      foodName: 'Sample beans',
      storageLocation: { name: 'Sample pantry', capacity: 5 },
      eatWithinDays: 3,
      totalQuantity: 2.5,
      lots: [
        {
          id: 'lot_example_beans',
          quantity: 3,
          remainingQuantity: 2.5,
          receivedDate: '2026-09-01',
          bestBefore: '2026-10-31',
          eatBy: '2026-10-20',
        },
      ],
      storageLocationId: 'location_example_pantry',
    },
  ],
  plannedDeliveries: [
    {
      id: 'delivery_example',
      sourceRef: 'order_example',
      expectedDate: '2026-10-25',
      changeDeadline: '2026-10-20',
      items: [
        {
          foodMasterId: 'food_example_oats',
          foodName: 'Sample oats',
          quantity: 2,
        },
      ],
    },
  ],
  capacityWarnings: [
    {
      id: 'capacity_warning_example',
      storageLocationId: 'location_example_pantry',
      storageLocationName: 'Sample pantry',
      expectedDate: '2026-10-25',
      deliveries: [
        {
          deliveryId: 'delivery_example',
          changeDeadline: '2026-10-20',
        },
      ],
      projectedQuantity: 7,
      capacity: 5,
      excessQuantity: 2,
    },
  ],
  eatByWarnings: [
    {
      id: 'eat_by_warning_example',
      riskType: 'deadline_passed',
      stockLotId: 'lot_example_peas',
      foodMasterId: 'food_example_peas',
      foodName: 'Sample peas',
      targetDate: '2026-10-15',
      targetDateType: 'eat_by',
      remainingQuantity: 1,
      quantityUsedForRate: null,
      daysUntilTarget: null,
      requiredDailyConsumption: null,
      actualDailyConsumption: 0.25,
    },
  ],
  priorityLots: [
    {
      foodMasterId: 'food_example_peas',
      foodName: 'Sample peas',
      stockLotId: 'lot_example_peas',
      remainingQuantity: 1,
      targetDate: '2026-10-15',
      reasons: ['deadline_passed'],
    },
  ],
}

const EMPTY_STOCK_STATUS: StockStatus = {
  stockItems: [],
  plannedDeliveries: [],
  capacityWarnings: [],
  eatByWarnings: [],
  priorityLots: [],
}

const buildApp = (stockService: StockService): Hono => {
  const app = new Hono()
  mountStockRoutes(app, stockService)
  return app
}

const responseSnapshot = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
})

const responseCallsSnapshot = async <Calls>(
  responses: ReadonlyArray<Response>,
  calls: Calls,
) => ({
  responses: await Promise.all(responses.map(responseSnapshot)),
  calls,
})

describe('GET /api/stock', () => {
  it('returns the complete stock status in camelCase JSON', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      getStockStatus: () => okAsync(SAMPLE_STOCK_STATUS),
    })

    const res = await app.request('/api/stock')

    expect(await responseSnapshot(res)).toEqual({
      status: 200,
      body: SAMPLE_STOCK_STATUS,
    })
  })

  it('returns all five arrays when the stock status is empty', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      getStockStatus: () => okAsync(EMPTY_STOCK_STATUS),
    })

    const res = await app.request('/api/stock')

    expect(await responseSnapshot(res)).toEqual({
      status: 200,
      body: {
        stockItems: [],
        plannedDeliveries: [],
        capacityWarnings: [],
        eatByWarnings: [],
        priorityLots: [],
      },
    })
  })

  it('returns the shared server error response when reading stock fails', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      getStockStatus: () =>
        errAsync(
          new StockDomainError(
            'persistence_failed',
            'stock status unavailable',
          ),
        ),
    })

    const res = await app.request('/api/stock')

    expect(await responseSnapshot(res)).toEqual({
      status: 500,
      body: { error: 'stock status unavailable' },
    })
  })
})

describe('POST /api/stock/counts', () => {
  it('records zero and fractional counts with optional lot dates', async () => {
    const inputs = [
      {
        foodMasterId: 'food_example_beans',
        quantity: 0.75,
        receivedDate: '2026-09-02',
        bestBefore: null,
      },
      { foodMasterId: 'food_example_oats', quantity: 0 },
    ]
    const countStock = vi.fn((input: (typeof inputs)[number]) =>
      okAsync({
        foodMasterId: input.foodMasterId,
        previousQuantity: 1,
        countedQuantity: input.quantity,
        difference: input.quantity - 1,
      }),
    )
    const app = buildApp({
      ...createStubApiDeps().stockService,
      countStock,
    })

    const responses: Array<Response> = []
    for (const input of inputs) {
      responses.push(
        await app.request('/api/stock/counts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
    }

    expect(
      await responseCallsSnapshot(responses, countStock.mock.calls),
    ).toEqual({
      responses: [
        {
          status: 200,
          body: {
            foodMasterId: 'food_example_beans',
            previousQuantity: 1,
            countedQuantity: 0.75,
            difference: -0.25,
          },
        },
        {
          status: 200,
          body: {
            foodMasterId: 'food_example_oats',
            previousQuantity: 1,
            countedQuantity: 0,
            difference: -1,
          },
        },
      ],
      calls: [[inputs[0]], [inputs[1]]],
    })
  })

  it('rejects invalid quantities and dates before calling the service', async () => {
    const countStock = vi.fn(() =>
      okAsync({
        foodMasterId: 'food_example_beans',
        previousQuantity: 1,
        countedQuantity: 1,
        difference: 0,
      }),
    )
    const app = buildApp({
      ...createStubApiDeps().stockService,
      countStock,
    })
    const invalidInputs = [
      { foodMasterId: 'food_example_beans', quantity: -1 },
      {
        foodMasterId: 'food_example_beans',
        quantity: 1,
        receivedDate: '2026-02-30',
      },
    ]

    const responses: Array<Response> = []
    for (const input of invalidInputs) {
      responses.push(
        await app.request('/api/stock/counts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(input),
        }),
      )
    }

    expect(
      await responseCallsSnapshot(responses, countStock.mock.calls),
    ).toEqual({
      responses: [
        {
          status: 400,
          body: { error: 'Too small: expected number to be >=0' },
        },
        { status: 400, body: { error: 'Invalid ISO date' } },
      ],
      calls: [],
    })
  })

  it('returns not found when the food is not tracked in stock', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      countStock: () =>
        errAsync(
          new StockDomainError('stock_item_not_found', 'stock item not found'),
        ),
    })

    const res = await app.request('/api/stock/counts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        foodMasterId: 'food_example_unknown',
        quantity: 1,
      }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: 'stock item not found' },
    })
  })

  it('returns the shared server error response when persistence fails', async () => {
    const app = buildApp({
      ...createStubApiDeps().stockService,
      countStock: () =>
        errAsync(
          new StockDomainError('persistence_failed', 'stock count unavailable'),
        ),
    })

    const res = await app.request('/api/stock/counts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foodMasterId: 'food_example_beans', quantity: 1 }),
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 500,
      body: { error: 'stock count unavailable' },
    })
  })
})
