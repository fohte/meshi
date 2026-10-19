import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiRequestError } from '#api/errors'
import { fetchStockStatus } from '#api/stock'

const STOCK_STATUS = {
  stockItems: [
    {
      foodMasterId: 'food_example_flour',
      foodName: '架空粉',
      storageLocation: { name: '保存棚', capacity: null },
      eatWithinDays: null,
      totalQuantity: 0.5,
      lots: [
        {
          id: 'lot_example_flour',
          quantity: 1,
          remainingQuantity: 0.5,
          receivedDate: null,
          bestBefore: '2026-11-01',
          eatBy: null,
        },
      ],
      storageLocationId: 'location_example_shelf',
    },
  ],
  plannedDeliveries: [
    {
      id: 'delivery_example',
      sourceRef: null,
      expectedDate: '2026-11-03',
      changeDeadline: null,
      items: [
        {
          foodMasterId: 'food_example_flour',
          foodName: '架空粉',
          quantity: 1.5,
        },
      ],
    },
  ],
  capacityWarnings: [
    {
      id: 'capacity_warning_example',
      storageLocationId: 'location_example_shelf',
      storageLocationName: '保存棚',
      expectedDate: '2026-11-03',
      deliveries: [{ deliveryId: 'delivery_example', changeDeadline: null }],
      projectedQuantity: 4.5,
      capacity: 4,
      excessQuantity: 0.5,
    },
  ],
  eatByWarnings: [
    {
      id: 'eat_by_warning_example',
      riskType: 'deadline_passed',
      stockLotId: 'lot_example_flour',
      foodMasterId: 'food_example_flour',
      foodName: '架空粉',
      targetDate: '2026-10-01',
      targetDateType: 'best_before',
      remainingQuantity: 0.5,
      quantityUsedForRate: null,
      daysUntilTarget: null,
      requiredDailyConsumption: null,
      actualDailyConsumption: 0,
    },
  ],
  priorityLots: [
    {
      foodMasterId: 'food_example_flour',
      foodName: '架空粉',
      stockLotId: 'lot_example_flour',
      remainingQuantity: 0.5,
      targetDate: null,
      reasons: ['deadline_passed', 'oldest_received'],
    },
  ],
}

const mockFetchOk = (body: unknown): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  )
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const normalizedApiError = (error: ApiRequestError) => ({
  name: error.name,
  message: error.message,
})

const readFetchOutput = (
  fetchMock: ReturnType<typeof vi.fn>,
  result: Awaited<ReturnType<typeof fetchStockStatus>>,
) => ({
  request: fetchMock.mock.calls,
  status: result._unsafeUnwrap(),
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchStockStatus', () => {
  it('requests and returns the validated stock status', async () => {
    const fetchMock = mockFetchOk(STOCK_STATUS)

    const result = await fetchStockStatus()

    expect(readFetchOutput(fetchMock, result)).toEqual({
      request: [['/api/stock', undefined]],
      status: STOCK_STATUS,
    })
  })

  it('returns an ApiRequestError when any nested response field is invalid', async () => {
    mockFetchOk({
      ...STOCK_STATUS,
      eatByWarnings: [
        { ...STOCK_STATUS.eatByWarnings[0], targetDateType: 'best-before' },
      ],
    })

    const result = await fetchStockStatus()

    expect(normalizedApiError(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: '/api/stock response did not match the expected schema',
    })
  })

  it('rejects additional fields rather than silently accepting an unknown contract', async () => {
    mockFetchOk({ ...STOCK_STATUS, unexpected: true })

    const result = await fetchStockStatus()

    expect(normalizedApiError(result._unsafeUnwrapErr())).toEqual({
      name: 'ApiRequestError',
      message: '/api/stock response did not match the expected schema',
    })
  })
})
