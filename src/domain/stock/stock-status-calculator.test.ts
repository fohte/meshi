import { expect, it } from 'vitest'

import { calculateStockStatus } from '#domain/stock/stock-status-calculator'
import type { StockStatusSnapshot } from '#domain/stock/types'
import { toJstDateString } from '#lib/jst-date'

const TODAY = toJstDateString(new Date('2026-10-18T03:00:00.000Z'))

const makeStockItem = (input: {
  readonly foodMasterId: string
  readonly storageLocationId?: string | null
  readonly storageLocationName?: string
  readonly capacity?: number | null
  readonly totalQuantity?: number
  readonly lots?: StockStatusSnapshot['stockItems'][number]['lots']
}): StockStatusSnapshot['stockItems'][number] => {
  const storageLocationId = input.storageLocationId ?? null
  return {
    foodMasterId: input.foodMasterId,
    foodName: 'Sample food',
    storageLocationId,
    storageLocation:
      storageLocationId === null
        ? null
        : {
            name: input.storageLocationName ?? 'Sample shelf',
            capacity: input.capacity ?? null,
          },
    eatWithinDays: null,
    totalQuantity: input.totalQuantity ?? 0,
    lots: input.lots ?? [],
  }
}

const makeLot = (
  id: string,
  remainingQuantity: number,
  dates: {
    readonly receivedDate?: string | null
    readonly bestBefore?: string | null
    readonly eatBy?: string | null
  } = {},
): StockStatusSnapshot['stockItems'][number]['lots'][number] => ({
  id,
  quantity: remainingQuantity,
  remainingQuantity,
  receivedDate: dates.receivedDate ?? '2026-10-01',
  bestBefore: dates.bestBefore ?? null,
  eatBy: dates.eatBy ?? null,
})

const makeDelivery = (
  id: string,
  expectedDate: string,
  foodMasterId: string,
  quantity: number,
  changeDeadline: string | null = null,
): StockStatusSnapshot['plannedDeliveries'][number] => ({
  id,
  sourceRef: null,
  expectedDate,
  changeDeadline,
  items: [{ foodMasterId, foodName: 'Sample food', quantity }],
})

const makeSnapshot = (
  stockItems: StockStatusSnapshot['stockItems'],
  plannedDeliveries: StockStatusSnapshot['plannedDeliveries'] = [],
  recentConsumption: StockStatusSnapshot['recentConsumption'] = [],
): StockStatusSnapshot => ({ stockItems, plannedDeliveries, recentConsumption })

it('does not warn when a delivery or lot deadline is four days away', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        storageLocationId: 'sl_sample',
        capacity: 4,
        totalQuantity: 1,
        lots: [makeLot('stl_sample', 1, { bestBefore: '2026-10-22' })],
      }),
    ],
    [makeDelivery('dly_sample', '2026-10-22', 'fm_sample', 4)],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
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

it('warns on the current day and exactly three days before a best-before date', () => {
  const snapshot = makeSnapshot([
    makeStockItem({
      foodMasterId: 'fm_today',
      lots: [makeLot('stl_today', 0.5, { bestBefore: '2026-10-18' })],
    }),
    makeStockItem({
      foodMasterId: 'fm_three_days',
      lots: [makeLot('stl_three_days', 2, { bestBefore: '2026-10-21' })],
    }),
    makeStockItem({
      foodMasterId: 'fm_four_days',
      lots: [makeLot('stl_four_days', 1, { bestBefore: '2026-10-22' })],
    }),
  ])

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [
      {
        id: 'eat-by-risk:stl_today:2026-10-18:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_today',
        foodMasterId: 'fm_today',
        foodName: 'Sample food',
        targetDate: '2026-10-18',
        targetDateType: 'best_before',
        remainingQuantity: 0.5,
        quantityUsedForRate: 0.5,
        daysUntilTarget: 0,
        requiredDailyConsumption: 0.5,
        actualDailyConsumption: 0,
      },
      {
        id: 'eat-by-risk:stl_three_days:2026-10-21:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_three_days',
        foodMasterId: 'fm_three_days',
        foodName: 'Sample food',
        targetDate: '2026-10-21',
        targetDateType: 'best_before',
        remainingQuantity: 2,
        quantityUsedForRate: 2,
        daysUntilTarget: 3,
        requiredDailyConsumption: 0.67,
        actualDailyConsumption: 0,
      },
    ],
    priorityLots: [
      {
        foodMasterId: 'fm_today',
        foodName: 'Sample food',
        stockLotId: 'stl_today',
        remainingQuantity: 0.5,
        targetDate: '2026-10-18',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_three_days',
        foodName: 'Sample food',
        stockLotId: 'stl_three_days',
        remainingQuantity: 2,
        targetDate: '2026-10-21',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_four_days',
        foodName: 'Sample food',
        stockLotId: 'stl_four_days',
        remainingQuantity: 1,
        targetDate: '2026-10-22',
        reasons: ['best_before'],
      },
    ],
  })
})

it('reports eat-by, best-before, and the earlier of both target dates', () => {
  const snapshot = makeSnapshot([
    makeStockItem({
      foodMasterId: 'fm_eat_by_only',
      lots: [makeLot('stl_eat_by_only', 2, { eatBy: '2026-10-20' })],
    }),
    makeStockItem({
      foodMasterId: 'fm_best_before_only',
      lots: [makeLot('stl_best_before_only', 3, { bestBefore: '2026-10-21' })],
    }),
    makeStockItem({
      foodMasterId: 'fm_both_dates',
      lots: [
        makeLot('stl_both_dates', 4, {
          bestBefore: '2026-10-21',
          eatBy: '2026-10-19',
        }),
      ],
    }),
  ])

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [
      {
        id: 'eat-by-risk:stl_both_dates:2026-10-19:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_both_dates',
        foodMasterId: 'fm_both_dates',
        foodName: 'Sample food',
        targetDate: '2026-10-19',
        targetDateType: 'eat_by',
        remainingQuantity: 4,
        quantityUsedForRate: 4,
        daysUntilTarget: 1,
        requiredDailyConsumption: 4,
        actualDailyConsumption: 0,
      },
      {
        id: 'eat-by-risk:stl_eat_by_only:2026-10-20:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_eat_by_only',
        foodMasterId: 'fm_eat_by_only',
        foodName: 'Sample food',
        targetDate: '2026-10-20',
        targetDateType: 'eat_by',
        remainingQuantity: 2,
        quantityUsedForRate: 2,
        daysUntilTarget: 2,
        requiredDailyConsumption: 1,
        actualDailyConsumption: 0,
      },
      {
        id: 'eat-by-risk:stl_best_before_only:2026-10-21:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_best_before_only',
        foodMasterId: 'fm_best_before_only',
        foodName: 'Sample food',
        targetDate: '2026-10-21',
        targetDateType: 'best_before',
        remainingQuantity: 3,
        quantityUsedForRate: 3,
        daysUntilTarget: 3,
        requiredDailyConsumption: 1,
        actualDailyConsumption: 0,
      },
    ],
    priorityLots: [
      {
        foodMasterId: 'fm_both_dates',
        foodName: 'Sample food',
        stockLotId: 'stl_both_dates',
        remainingQuantity: 4,
        targetDate: '2026-10-19',
        reasons: ['eat_by', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_eat_by_only',
        foodName: 'Sample food',
        stockLotId: 'stl_eat_by_only',
        remainingQuantity: 2,
        targetDate: '2026-10-20',
        reasons: ['eat_by', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_best_before_only',
        foodName: 'Sample food',
        stockLotId: 'stl_best_before_only',
        remainingQuantity: 3,
        targetDate: '2026-10-21',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
    ],
  })
})

it('reports null required consumption for a passed deadline', () => {
  const snapshot = makeSnapshot([
    makeStockItem({
      foodMasterId: 'fm_expired',
      lots: [makeLot('stl_expired', 2, { eatBy: '2026-10-17' })],
    }),
  ])

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [
      {
        id: 'eat-by-risk:stl_expired:2026-10-17:deadline_passed',
        riskType: 'deadline_passed',
        stockLotId: 'stl_expired',
        foodMasterId: 'fm_expired',
        foodName: 'Sample food',
        targetDate: '2026-10-17',
        targetDateType: 'eat_by',
        remainingQuantity: 2,
        quantityUsedForRate: null,
        daysUntilTarget: null,
        requiredDailyConsumption: null,
        actualDailyConsumption: 0,
      },
    ],
    priorityLots: [
      {
        foodMasterId: 'fm_expired',
        foodName: 'Sample food',
        stockLotId: 'stl_expired',
        remainingQuantity: 2,
        targetDate: '2026-10-17',
        reasons: ['eat_by', 'deadline_passed'],
      },
    ],
  })
})

it('includes lots with the same or earlier target date in the required pace', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        lots: [
          makeLot('stl_earlier', 0.5, { bestBefore: '2026-10-19' }),
          makeLot('stl_same_a', 1, { bestBefore: '2026-10-20' }),
          makeLot('stl_same_b', 1, { bestBefore: '2026-10-20' }),
        ],
      }),
    ],
    [],
    [{ foodMasterId: 'fm_sample', quantity: 7 }],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [
      {
        id: 'eat-by-risk:stl_same_a:2026-10-20:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_same_a',
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        targetDate: '2026-10-20',
        targetDateType: 'best_before',
        remainingQuantity: 1,
        quantityUsedForRate: 2.5,
        daysUntilTarget: 2,
        requiredDailyConsumption: 1.25,
        actualDailyConsumption: 0.5,
      },
      {
        id: 'eat-by-risk:stl_same_b:2026-10-20:consumption_rate_below_required',
        riskType: 'consumption_rate_below_required',
        stockLotId: 'stl_same_b',
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        targetDate: '2026-10-20',
        targetDateType: 'best_before',
        remainingQuantity: 1,
        quantityUsedForRate: 2.5,
        daysUntilTarget: 2,
        requiredDailyConsumption: 1.25,
        actualDailyConsumption: 0.5,
      },
    ],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_earlier',
        remainingQuantity: 0.5,
        targetDate: '2026-10-19',
        reasons: ['best_before'],
      },
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_same_a',
        remainingQuantity: 1,
        targetDate: '2026-10-20',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_same_b',
        remainingQuantity: 1,
        targetDate: '2026-10-20',
        reasons: ['best_before', 'consumption_rate_below_required'],
      },
    ],
  })
})

it('suppresses a warning when actual consumption meets the required pace', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        lots: [makeLot('stl_sample', 2, { bestBefore: '2026-10-21' })],
      }),
    ],
    [],
    [{ foodMasterId: 'fm_sample', quantity: 14 }],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample',
        remainingQuantity: 2,
        targetDate: '2026-10-21',
        reasons: ['best_before'],
      },
    ],
  })
})

it('suppresses a warning when the unrounded rates differ only within tolerance', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        lots: [makeLot('stl_sample', 2, { bestBefore: '2026-10-21' })],
      }),
    ],
    [],
    [{ foodMasterId: 'fm_sample', quantity: 9.333333 }],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: [],
    capacityWarnings: [],
    eatByWarnings: [],
    priorityLots: [
      {
        foodMasterId: 'fm_sample',
        foodName: 'Sample food',
        stockLotId: 'stl_sample',
        remainingQuantity: 2,
        targetDate: '2026-10-21',
        reasons: ['best_before'],
      },
    ],
  })
})

it('groups same-day deliveries by storage location and skips locations without capacity', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_first_location',
        storageLocationId: 'sl_first',
        storageLocationName: 'Sample freezer',
        capacity: 4,
      }),
      makeStockItem({
        foodMasterId: 'fm_second_location',
        storageLocationId: 'sl_second',
        storageLocationName: 'Sample pantry',
        capacity: 2,
      }),
      makeStockItem({
        foodMasterId: 'fm_without_capacity',
        storageLocationId: 'sl_unlimited',
        storageLocationName: 'Sample cupboard',
        capacity: null,
      }),
    ],
    [
      makeDelivery('dly_first_a', '2026-10-21', 'fm_first_location', 2),
      makeDelivery(
        'dly_first_b',
        '2026-10-21',
        'fm_first_location',
        3,
        '2026-10-20',
      ),
      makeDelivery('dly_today', '2026-10-18', 'fm_second_location', 3),
      makeDelivery('dly_unlimited', '2026-10-18', 'fm_without_capacity', 10),
      makeDelivery('dly_outside_window', '2026-10-22', 'fm_first_location', 10),
    ],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: [
      {
        id: 'capacity-overflow:sl_second:due',
        storageLocationId: 'sl_second',
        storageLocationName: 'Sample pantry',
        expectedDate: '2026-10-18',
        deliveries: [{ deliveryId: 'dly_today', changeDeadline: null }],
        projectedQuantity: 3,
        capacity: 2,
        excessQuantity: 1,
      },
      {
        id: 'capacity-overflow:sl_first:2026-10-21',
        storageLocationId: 'sl_first',
        storageLocationName: 'Sample freezer',
        expectedDate: '2026-10-21',
        deliveries: [
          { deliveryId: 'dly_first_a', changeDeadline: null },
          { deliveryId: 'dly_first_b', changeDeadline: '2026-10-20' },
        ],
        projectedQuantity: 5,
        capacity: 4,
        excessQuantity: 1,
      },
    ],
    eatByWarnings: [],
    priorityLots: [],
  })
})

it('groups overdue and due-today deliveries under a stable warning id', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        storageLocationId: 'sl_sample',
        capacity: 4,
      }),
    ],
    [
      makeDelivery('dly_overdue', '2026-10-15', 'fm_sample', 5, '2026-10-14'),
      makeDelivery('dly_today', '2026-10-18', 'fm_sample', 2, '2026-10-17'),
    ],
  )
  const tomorrow = toJstDateString(new Date('2026-10-19T03:00:00.000Z'))

  const expectedToday = {
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: [
      {
        id: 'capacity-overflow:sl_sample:due',
        storageLocationId: 'sl_sample',
        storageLocationName: 'Sample shelf',
        expectedDate: '2026-10-18',
        deliveries: [
          { deliveryId: 'dly_overdue', changeDeadline: '2026-10-14' },
          { deliveryId: 'dly_today', changeDeadline: '2026-10-17' },
        ],
        projectedQuantity: 7,
        capacity: 4,
        excessQuantity: 3,
      },
    ],
    eatByWarnings: [],
    priorityLots: [],
  }
  const expectedTomorrow = {
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: [
      {
        id: 'capacity-overflow:sl_sample:due',
        storageLocationId: 'sl_sample',
        storageLocationName: 'Sample shelf',
        expectedDate: '2026-10-19',
        deliveries: [
          { deliveryId: 'dly_overdue', changeDeadline: '2026-10-14' },
          { deliveryId: 'dly_today', changeDeadline: '2026-10-17' },
        ],
        projectedQuantity: 7,
        capacity: 4,
        excessQuantity: 3,
      },
    ],
    eatByWarnings: [],
    priorityLots: [],
  }

  const getResults = () => ({
    today: calculateStockStatus(snapshot, TODAY),
    tomorrow: calculateStockStatus(snapshot, tomorrow),
  })
  const expectedAcrossDays = {
    today: expectedToday,
    tomorrow: expectedTomorrow,
  }

  expect(getResults()).toEqual(expectedAcrossDays)
})

it('projects capacity across arrivals without consuming unavailable stock', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        storageLocationId: 'sl_sample',
        storageLocationName: 'Sample freezer',
        capacity: 4,
        totalQuantity: 0.5,
        lots: [makeLot('stl_sample', 0.5)],
      }),
    ],
    [
      makeDelivery('dly_soon', '2026-10-19', 'fm_sample', 3),
      makeDelivery('dly_later', '2026-10-21', 'fm_sample', 4),
    ],
    [{ foodMasterId: 'fm_sample', quantity: 14 }],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
    stockItems: snapshot.stockItems,
    plannedDeliveries: snapshot.plannedDeliveries,
    capacityWarnings: [
      {
        id: 'capacity-overflow:sl_sample:2026-10-21',
        storageLocationId: 'sl_sample',
        storageLocationName: 'Sample freezer',
        expectedDate: '2026-10-21',
        deliveries: [{ deliveryId: 'dly_later', changeDeadline: null }],
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
        targetDate: null,
        reasons: ['oldest_received'],
      },
    ],
  })
})

it('places undated lots last with no deadline target', () => {
  const snapshot = makeSnapshot(
    [
      makeStockItem({
        foodMasterId: 'fm_sample',
        lots: [
          makeLot('stl_dated', 1, { bestBefore: '2026-10-20' }),
          makeLot('stl_undated', 3, { bestBefore: null, eatBy: null }),
        ],
      }),
    ],
    [],
    [{ foodMasterId: 'fm_sample', quantity: 7 }],
  )

  expect(calculateStockStatus(snapshot, TODAY)).toEqual({
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
        targetDate: null,
        reasons: ['oldest_received'],
      },
    ],
  })
})
