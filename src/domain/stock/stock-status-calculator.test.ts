import { expect, it } from 'vitest'

import { calculateStockStatus } from '#domain/stock/stock-status-calculator'
import type { StockStatusSnapshot } from '#domain/stock/types'
import { toJstDateString } from '#lib/jst-date'

it('does not warn when a delivery or lot deadline is four days away', () => {
  const snapshot: StockStatusSnapshot = {
    stockItems: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        storageLocationId: 'sl_sample',
        storageLocation: { name: 'Sample shelf', capacity: 4 },
        eatWithinDays: null,
        totalQuantity: 1,
        lots: [
          {
            id: 'stl_sample',
            quantity: 1,
            remainingQuantity: 1,
            receivedDate: '2026-10-01',
            bestBefore: '2026-10-22',
            eatBy: null,
          },
        ],
      },
    ],
    plannedDeliveries: [
      {
        id: 'dly_sample',
        sourceRef: 'sample-order',
        expectedDate: '2026-10-22',
        changeDeadline: '2026-10-20',
        items: [
          { foodMasterId: 'fm_sample', foodName: 'Sample food', quantity: 4 },
        ],
      },
    ],
    recentConsumption: [],
  }

  expect(
    calculateStockStatus(
      snapshot,
      toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
    ),
  ).toEqual({
    stockItems: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        storageLocationId: 'sl_sample',
        storageLocation: { name: 'Sample shelf', capacity: 4 },
        eatWithinDays: null,
        totalQuantity: 1,
        lots: [
          {
            id: 'stl_sample',
            quantity: 1,
            remainingQuantity: 1,
            receivedDate: '2026-10-01',
            bestBefore: '2026-10-22',
            eatBy: null,
          },
        ],
      },
    ],
    plannedDeliveries: [
      {
        id: 'dly_sample',
        sourceRef: 'sample-order',
        expectedDate: '2026-10-22',
        changeDeadline: '2026-10-20',
        items: [
          { foodMasterId: 'fm_sample', foodName: 'Sample food', quantity: 4 },
        ],
      },
    ],
    capacityWarnings: [],
    eatByWarnings: [],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample',
        remainingQuantity: 1,
        targetDate: '2026-10-22',
        reasons: ['best_before'],
      },
    ],
  })
})
