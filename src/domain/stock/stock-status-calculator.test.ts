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

it('keeps undated lots as oldest received and suppresses warnings at a sufficient pace', () => {
  const snapshot: StockStatusSnapshot = {
    stockItems: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        storageLocationId: null,
        storageLocation: null,
        eatWithinDays: null,
        totalQuantity: 4,
        lots: [
          {
            id: 'stl_dated',
            quantity: 1,
            remainingQuantity: 1,
            receivedDate: '2026-10-01',
            bestBefore: '2026-10-20',
            eatBy: null,
          },
          {
            id: 'stl_undated',
            quantity: 3,
            remainingQuantity: 3,
            receivedDate: '2026-08-01',
            bestBefore: null,
            eatBy: null,
          },
        ],
      },
    ],
    plannedDeliveries: [],
    recentConsumption: [{ foodMasterId: 'fm_sample', quantity: 7 }],
  }

  expect(
    calculateStockStatus(
      snapshot,
      toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
    ),
  ).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_dated',
        remainingQuantity: 1,
        targetDate: '2026-10-20',
        reasons: ['best_before'],
      },
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_undated',
        remainingQuantity: 3,
        targetDate: '2026-08-01',
        reasons: ['oldest_received'],
      },
    ],
  })
})

it('compares the combined quantity due for a food against its consumption pace', () => {
  const snapshot: StockStatusSnapshot = {
    stockItems: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        storageLocationId: null,
        storageLocation: null,
        eatWithinDays: null,
        totalQuantity: 2,
        lots: [
          {
            id: 'stl_sample_a',
            quantity: 1,
            remainingQuantity: 1,
            receivedDate: '2026-10-01',
            bestBefore: '2026-10-20',
            eatBy: null,
          },
          {
            id: 'stl_sample_b',
            quantity: 1,
            remainingQuantity: 1,
            receivedDate: '2026-10-02',
            bestBefore: '2026-10-20',
            eatBy: null,
          },
        ],
      },
    ],
    plannedDeliveries: [],
    recentConsumption: [{ foodMasterId: 'fm_sample', quantity: 7 }],
  }

  expect(
    calculateStockStatus(
      snapshot,
      toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
    ),
  ).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [
      {
        id: 'eat-by-risk:stl_sample_a',
        stockLotId: 'stl_sample_a',
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        targetDate: '2026-10-20',
        targetDateType: 'best_before',
        remainingQuantity: 1,
        requiredDailyConsumption: 1,
        actualDailyConsumption: 0.5,
      },
      {
        id: 'eat-by-risk:stl_sample_b',
        stockLotId: 'stl_sample_b',
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        targetDate: '2026-10-20',
        targetDateType: 'best_before',
        remainingQuantity: 1,
        requiredDailyConsumption: 1,
        actualDailyConsumption: 0.5,
      },
    ],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample_a',
        remainingQuantity: 1,
        targetDate: '2026-10-20',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample_b',
        remainingQuantity: 1,
        targetDate: '2026-10-20',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
    ],
  })
})

it('projects capacity across arrivals without consuming unavailable stock', () => {
  const snapshot: StockStatusSnapshot = {
    stockItems: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        storageLocationId: 'sl_sample',
        storageLocation: { name: 'Sample freezer', capacity: 4 },
        eatWithinDays: null,
        totalQuantity: 0.5,
        lots: [
          {
            id: 'stl_sample',
            quantity: 0.5,
            remainingQuantity: 0.5,
            receivedDate: '2026-10-01',
            bestBefore: null,
            eatBy: null,
          },
        ],
      },
    ],
    plannedDeliveries: [
      {
        id: 'dly_soon',
        sourceRef: null,
        expectedDate: '2026-10-19',
        changeDeadline: null,
        items: [
          { foodMasterId: 'fm_sample', foodName: 'Sample food', quantity: 3 },
        ],
      },
      {
        id: 'dly_later',
        sourceRef: null,
        expectedDate: '2026-10-21',
        changeDeadline: null,
        items: [
          { foodMasterId: 'fm_sample', foodName: 'Sample food', quantity: 4 },
        ],
      },
    ],
    recentConsumption: [{ foodMasterId: 'fm_sample', quantity: 14 }],
  }

  expect(
    calculateStockStatus(
      snapshot,
      toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
    ),
  ).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: [
      {
        id: 'capacity-overflow:dly_later:sl_sample',
        storageLocationId: 'sl_sample',
        storageLocationName: 'Sample freezer',
        deliveryId: 'dly_later',
        sourceRef: null,
        expectedDate: '2026-10-21',
        changeDeadline: null,
        projectedQuantity: 5,
        capacity: 4,
        excessQuantity: 1,
      },
    ],
    eatByWarnings: [],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample',
        remainingQuantity: 0.5,
        targetDate: '2026-10-01',
        reasons: ['oldest_received'],
      },
    ],
  })
})
