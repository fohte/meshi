import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

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
