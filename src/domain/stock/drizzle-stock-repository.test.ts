import { beforeEach, expect, it } from 'vitest'

import { createDrizzleStockRepository } from '#domain/stock/drizzle-stock-repository'
import { createStockService } from '#domain/stock/stock-service'
import type { StockService } from '#domain/stock/types'
import { toJstDateString } from '#lib/jst-date'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import {
  seedDelivery,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
  seedStorageLocation,
} from '#test/seed'

describeIfDb('stock repository', () => {
  const getTx = setupDrizzleTx()
  let stockService: StockService

  beforeEach(() => {
    let n = 0
    const counter: IdCounter = {
      next: () => {
        n += 1
        return n
      },
    }
    stockService = createStockService(
      createDrizzleStockRepository(getTx(), {
        generateId: createCountingIdGenerator(counter),
        wrapInTransaction: false,
      }),
      { now: () => new Date('2026-10-18T03:00:00.000Z') },
    )
  })

  it('creates a stock item and a storage location by name', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_sample_stock',
      name: 'Sample stock food',
    })

    const result = (
      await stockService.setStockItem({
        foodMasterId: 'fm_sample_stock',
        storageLocationName: 'Sample freezer',
        storageLocationCapacity: 8,
        eatWithinDays: 20,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      foodMasterId: 'fm_sample_stock',
      foodName: 'Sample stock food',
      storageLocation: { name: 'Sample freezer', capacity: 8 },
      eatWithinDays: 20,
    })
  })

  it('preserves omitted settings and clears fields set to null', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_partial_settings',
      name: 'Sample food with partial settings',
    })
    const initialSettings = await stockService.setStockItem({
      foodMasterId: 'fm_partial_settings',
      storageLocationName: 'Sample pantry',
      storageLocationCapacity: 4,
      eatWithinDays: 12,
    })
    initialSettings._unsafeUnwrap()

    const result = (
      await stockService.setStockItem({
        foodMasterId: 'fm_partial_settings',
        eatWithinDays: null,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      foodMasterId: 'fm_partial_settings',
      foodName: 'Sample food with partial settings',
      storageLocation: { name: 'Sample pantry', capacity: 4 },
      eatWithinDays: null,
    })
  })

  it('updates lot dates in stock status and recalculates warnings', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_lot_date_patch',
      name: 'Sample lot date food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_lot_date_patch' })
    await seedStockLot(tx, {
      id: 'stl_lot_date_patch',
      foodMasterId: 'fm_lot_date_patch',
      quantity: 3,
      receivedDate: '2031-04-20',
      bestBefore: '2031-06-20',
      eatBy: '2031-06-25',
    })
    await seedStockMovement(tx, {
      id: 'stm_lot_date_patch',
      stockLotId: 'stl_lot_date_patch',
      delta: 2,
      reason: 'count',
    })
    stockService = createStockService(
      createDrizzleStockRepository(tx, { wrapInTransaction: false }),
      { now: () => new Date('2031-05-08T03:00:00.000Z') },
    )
    await stockService
      .updateStockLot({
        stockLotId: 'stl_lot_date_patch',
        bestBefore: '2031-05-10',
        eatBy: '2031-05-12',
      })
      .then((result) => result._unsafeUnwrap())
    const status = (await stockService.getStockStatus())._unsafeUnwrap()

    expect(status).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_lot_date_patch',
          foodName: 'Sample lot date food',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 2,
          lots: [
            {
              id: 'stl_lot_date_patch',
              quantity: 3,
              remainingQuantity: 2,
              receivedDate: '2031-04-20',
              bestBefore: '2031-05-10',
              eatBy: '2031-05-12',
            },
          ],
        },
      ],
      plannedDeliveries: [],
      capacityWarnings: [],
      eatByWarnings: [
        {
          id: 'eat-by-risk:stl_lot_date_patch:2031-05-10:consumption_rate_below_required',
          riskType: 'consumption_rate_below_required',
          stockLotId: 'stl_lot_date_patch',
          foodMasterId: 'fm_lot_date_patch',
          foodName: 'Sample lot date food',
          targetDate: '2031-05-10',
          targetDateType: 'best_before',
          remainingQuantity: 2,
          quantityUsedForRate: 2,
          daysUntilTarget: 2,
          requiredDailyConsumption: 1,
          actualDailyConsumption: 0,
        },
      ],
      priorityLots: [
        {
          foodMasterId: 'fm_lot_date_patch',
          foodName: 'Sample lot date food',
          stockLotId: 'stl_lot_date_patch',
          remainingQuantity: 2,
          targetDate: '2031-05-10',
          reasons: ['best_before', 'consumption_rate_below_required'],
        },
      ],
    })
  })

  it('preserves omitted eat_by and clears best_before when passed null', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_lot_date_clear',
      name: 'Sample food with editable lot dates',
    })
    await seedStockLot(tx, {
      id: 'stl_lot_date_clear',
      foodMasterId: 'fm_lot_date_clear',
      quantity: 1,
      bestBefore: '2031-06-20',
      eatBy: '2031-06-25',
    })

    const result = (
      await stockService.updateStockLot({
        stockLotId: 'stl_lot_date_clear',
        bestBefore: null,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'stl_lot_date_clear',
      bestBefore: null,
      eatBy: '2031-06-25',
    })
  })

  it('preserves omitted best_before and clears eat_by when passed null', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_lot_eat_by_clear',
      name: 'Sample food with an editable target date',
    })
    await seedStockLot(tx, {
      id: 'stl_lot_eat_by_clear',
      foodMasterId: 'fm_lot_eat_by_clear',
      quantity: 1,
      bestBefore: '2031-06-20',
      eatBy: '2031-06-25',
    })

    const result = (
      await stockService.updateStockLot({
        stockLotId: 'stl_lot_eat_by_clear',
        eatBy: null,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'stl_lot_eat_by_clear',
      bestBefore: '2031-06-20',
      eatBy: null,
    })
  })

  it('rejects updates for missing stock lots', async () => {
    const error = await captureDomainError(
      stockService.updateStockLot({
        stockLotId: 'stl_missing',
        eatBy: '2031-05-12',
      }),
    )

    expect(error).toEqual({
      code: 'stock_lot_not_found',
      details: { stockLotId: 'stl_missing' },
    })
  })

  it('clears the assigned storage location', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_clear_location',
      name: 'Sample food for clearing a location',
    })
    await stockService.setStockItem({
      foodMasterId: 'fm_clear_location',
      storageLocationName: 'Sample cupboard',
      storageLocationCapacity: 5,
      eatWithinDays: 9,
    })

    const result = (
      await stockService.setStockItem({
        foodMasterId: 'fm_clear_location',
        storageLocationName: null,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      foodMasterId: 'fm_clear_location',
      foodName: 'Sample food for clearing a location',
      storageLocation: null,
      eatWithinDays: 9,
    })
  })

  it('clears storage location capacity without clearing the location', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_clear_capacity',
      name: 'Sample food for clearing capacity',
    })
    await stockService.setStockItem({
      foodMasterId: 'fm_clear_capacity',
      storageLocationName: 'Sample cabinet',
      storageLocationCapacity: 7,
    })

    const result = (
      await stockService.setStockItem({
        foodMasterId: 'fm_clear_capacity',
        storageLocationCapacity: null,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      foodMasterId: 'fm_clear_capacity',
      foodName: 'Sample food for clearing capacity',
      storageLocation: { name: 'Sample cabinet', capacity: null },
      eatWithinDays: null,
    })
  })

  it('creates a dated lot when the first count adds fractional stock', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_first_count',
      name: 'Sample food for first count',
    })
    const settings = await stockService.setStockItem({
      foodMasterId: 'fm_first_count',
      eatWithinDays: 10,
    })
    settings._unsafeUnwrap()

    const count = await stockService.countStock({
      foodMasterId: 'fm_first_count',
      quantity: 2.5,
      receivedDate: '2026-10-01',
      bestBefore: '2026-11-01',
    })
    count._unsafeUnwrap()
    const status = (await stockService.getStockStatus())._unsafeUnwrap()

    expect(status).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_first_count',
          foodName: 'Sample food for first count',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: 10,
          totalQuantity: 2.5,
          lots: [
            {
              id: 'stl_test_0001',
              quantity: 2.5,
              remainingQuantity: 2.5,
              receivedDate: '2026-10-01',
              bestBefore: '2026-11-01',
              eatBy: '2026-10-11',
            },
          ],
        },
      ],
      plannedDeliveries: [],
      capacityWarnings: [],
      eatByWarnings: [
        {
          id: 'eat-by-risk:stl_test_0001:2026-10-11:deadline_passed',
          riskType: 'deadline_passed',
          stockLotId: 'stl_test_0001',
          foodMasterId: 'fm_first_count',
          foodName: 'Sample food for first count',
          targetDate: '2026-10-11',
          targetDateType: 'eat_by',
          remainingQuantity: 2.5,
          quantityUsedForRate: null,
          daysUntilTarget: null,
          requiredDailyConsumption: null,
          actualDailyConsumption: 0,
        },
      ],
      priorityLots: [
        {
          foodMasterId: 'fm_first_count',
          foodName: 'Sample food for first count',
          stockLotId: 'stl_test_0001',
          remainingQuantity: 2.5,
          targetDate: '2026-10-11',
          reasons: ['eat_by', 'deadline_passed'],
        },
      ],
    })
  })

  it('uses the recent 14-day meal pace for delivery and deadline warnings', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_forecast',
      name: 'Sample forecast food',
    })
    await seedStorageLocation(tx, {
      id: 'sl_forecast',
      name: 'Sample freezer',
      capacity: 4,
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_forecast',
      storageLocationId: 'sl_forecast',
      eatWithinDays: 7,
    })
    await seedStockLot(tx, {
      id: 'stl_forecast',
      foodMasterId: 'fm_forecast',
      quantity: 1,
      receivedDate: '2026-10-18',
      bestBefore: '2026-10-21',
      eatBy: '2026-10-25',
    })
    await seedStockMovement(tx, {
      id: 'stm_forecast',
      stockLotId: 'stl_forecast',
      delta: 1,
      reason: 'count',
    })
    await seedDelivery(tx, {
      id: 'dly_forecast_a',
      sourceRef: 'forecast-order-a',
      status: 'planned',
      expectedDate: '2026-10-21',
      changeDeadline: '2026-10-20',
    })
    await seedStockLot(tx, {
      id: 'stl_forecast_a',
      foodMasterId: 'fm_forecast',
      deliveryId: 'dly_forecast_a',
      quantity: 2,
    })
    await seedDelivery(tx, {
      id: 'dly_forecast_b',
      sourceRef: 'forecast-order-b',
      status: 'planned',
      expectedDate: '2026-10-21',
    })
    await seedStockLot(tx, {
      id: 'stl_forecast_b',
      foodMasterId: 'fm_forecast',
      deliveryId: 'dly_forecast_b',
      quantity: 3,
    })
    await seedMealLog(tx, {
      id: 'ml_forecast_start',
      foodMasterId: 'fm_forecast',
      eatenDate: toJstDateString(new Date('2026-10-05T03:00:00.000Z')),
      mealType: 'lunch',
      quantity: 2,
    })
    await seedMealLog(tx, {
      id: 'ml_forecast_today',
      foodMasterId: 'fm_forecast',
      eatenDate: toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
      mealType: 'dinner',
      quantity: 1.5,
    })
    await seedMealLog(tx, {
      id: 'ml_forecast_outside_window',
      foodMasterId: 'fm_forecast',
      eatenDate: toJstDateString(new Date('2026-10-03T03:00:00.000Z')),
      mealType: 'breakfast',
      quantity: 9,
    })
    await seedMealLog(tx, {
      id: 'ml_forecast_future',
      foodMasterId: 'fm_forecast',
      eatenDate: toJstDateString(new Date('2026-10-19T03:00:00.000Z')),
      mealType: 'breakfast',
      quantity: 8,
    })

    const status = (await stockService.getStockStatus())._unsafeUnwrap()

    expect(status).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_forecast',
          foodName: 'Sample forecast food',
          storageLocationId: 'sl_forecast',
          storageLocation: { name: 'Sample freezer', capacity: 4 },
          eatWithinDays: 7,
          totalQuantity: 1,
          lots: [
            {
              id: 'stl_forecast',
              quantity: 1,
              remainingQuantity: 1,
              receivedDate: '2026-10-18',
              bestBefore: '2026-10-21',
              eatBy: '2026-10-25',
            },
          ],
        },
      ],
      plannedDeliveries: [
        {
          id: 'dly_forecast_a',
          sourceRef: 'forecast-order-a',
          expectedDate: '2026-10-21',
          changeDeadline: '2026-10-20',
          items: [
            {
              foodMasterId: 'fm_forecast',
              foodName: 'Sample forecast food',
              quantity: 2,
            },
          ],
        },
        {
          id: 'dly_forecast_b',
          sourceRef: 'forecast-order-b',
          expectedDate: '2026-10-21',
          changeDeadline: null,
          items: [
            {
              foodMasterId: 'fm_forecast',
              foodName: 'Sample forecast food',
              quantity: 3,
            },
          ],
        },
      ],
      capacityWarnings: [
        {
          id: 'capacity-overflow:sl_forecast:2026-10-21',
          storageLocationId: 'sl_forecast',
          storageLocationName: 'Sample freezer',
          expectedDate: '2026-10-21',
          deliveries: [
            { deliveryId: 'dly_forecast_a', changeDeadline: '2026-10-20' },
            { deliveryId: 'dly_forecast_b', changeDeadline: null },
          ],
          projectedQuantity: 5.57,
          capacity: 4,
          excessQuantity: 1.57,
        },
      ],
      eatByWarnings: [
        {
          id: 'eat-by-risk:stl_forecast:2026-10-21:consumption_rate_below_required',
          riskType: 'consumption_rate_below_required',
          stockLotId: 'stl_forecast',
          foodMasterId: 'fm_forecast',
          foodName: 'Sample forecast food',
          targetDate: '2026-10-21',
          targetDateType: 'best_before',
          remainingQuantity: 1,
          quantityUsedForRate: 1,
          daysUntilTarget: 3,
          requiredDailyConsumption: 0.33,
          actualDailyConsumption: 0.14,
        },
      ],
      priorityLots: [
        {
          foodMasterId: 'fm_forecast',
          foodName: 'Sample forecast food',
          stockLotId: 'stl_forecast',
          remainingQuantity: 1,
          targetDate: '2026-10-21',
          reasons: ['best_before', 'consumption_rate_below_required'],
        },
      ],
    })
  })

  it('returns recent meal logs only for tracked foods in the prior fourteen days', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_tracked_window',
      name: 'Sample tracked food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_untracked_window',
      name: 'Sample untracked food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_tracked_window' })
    await seedStockLot(tx, {
      id: 'stl_tracked_window',
      foodMasterId: 'fm_tracked_window',
      quantity: 6,
      bestBefore: '2026-10-21',
    })
    await seedStockMovement(tx, {
      id: 'stm_tracked_window',
      stockLotId: 'stl_tracked_window',
      delta: 6,
      reason: 'count',
    })

    const meals = [
      {
        id: 'ml_window_today',
        foodMasterId: 'fm_tracked_window',
        eatenDate: toJstDateString(new Date('2026-10-18T03:00:00.000Z')),
        quantity: 100,
      },
      {
        id: 'ml_window_yesterday',
        foodMasterId: 'fm_tracked_window',
        eatenDate: toJstDateString(new Date('2026-10-17T03:00:00.000Z')),
        quantity: 2,
      },
      {
        id: 'ml_window_fourteen_days_ago',
        foodMasterId: 'fm_tracked_window',
        eatenDate: toJstDateString(new Date('2026-10-04T03:00:00.000Z')),
        quantity: 3,
      },
      {
        id: 'ml_window_fifteen_days_ago',
        foodMasterId: 'fm_tracked_window',
        eatenDate: toJstDateString(new Date('2026-10-03T03:00:00.000Z')),
        quantity: 100,
      },
      {
        id: 'ml_window_untracked_food',
        foodMasterId: 'fm_untracked_window',
        eatenDate: toJstDateString(new Date('2026-10-17T03:00:00.000Z')),
        quantity: 1000,
      },
    ]
    for (const meal of meals) {
      await seedMealLog(tx, { ...meal, mealType: 'lunch' })
    }

    const snapshot = (
      await createDrizzleStockRepository(tx, {
        wrapInTransaction: false,
      }).getStockStatus(toJstDateString(new Date('2026-10-18T03:00:00.000Z')))
    )._unsafeUnwrap()

    expect(snapshot).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_tracked_window',
          foodName: 'Sample tracked food',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 6,
          lots: [
            {
              id: 'stl_tracked_window',
              quantity: 6,
              remainingQuantity: 6,
              receivedDate: null,
              bestBefore: '2026-10-21',
              eatBy: null,
            },
          ],
        },
      ],
      plannedDeliveries: [],
      recentConsumption: [{ foodMasterId: 'fm_tracked_window', quantity: 5 }],
    })
  })

  it('returns the previous and counted quantities', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_count_summary',
      name: 'Sample food for count summary',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_count_summary' })

    const result = (
      await stockService.countStock({
        foodMasterId: 'fm_count_summary',
        quantity: 1.5,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      foodMasterId: 'fm_count_summary',
      previousQuantity: 0,
      countedQuantity: 1.5,
      difference: 1.5,
    })
  })

  it('reduces unknown and dated lots in FIFO order while preserving fractions', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_fifo_count',
      name: 'Sample food for FIFO count',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_fifo_count' })
    await seedStockLot(tx, {
      id: 'stl_unknown_date',
      foodMasterId: 'fm_fifo_count',
      quantity: 2,
    })
    await seedStockMovement(tx, {
      id: 'stm_unknown_date',
      stockLotId: 'stl_unknown_date',
      delta: 2,
      reason: 'count',
    })
    await seedStockLot(tx, {
      id: 'stl_older_date',
      foodMasterId: 'fm_fifo_count',
      quantity: 3,
      receivedDate: '2026-10-01',
    })
    await seedStockMovement(tx, {
      id: 'stm_older_date',
      stockLotId: 'stl_older_date',
      delta: 3,
      reason: 'count',
    })
    await seedStockLot(tx, {
      id: 'stl_newer_date',
      foodMasterId: 'fm_fifo_count',
      quantity: 4,
      receivedDate: '2026-10-02',
    })
    await seedStockMovement(tx, {
      id: 'stm_newer_date',
      stockLotId: 'stl_newer_date',
      delta: 4,
      reason: 'count',
    })

    const count = await stockService.countStock({
      foodMasterId: 'fm_fifo_count',
      quantity: 5.5,
    })
    count._unsafeUnwrap()
    const movements = await tx<
      { stock_lot_id: string; delta: string; reason: string }[]
    >`
      SELECT stock_lot_id, delta::text AS delta, reason
      FROM stock_movements
      WHERE delta < 0
      ORDER BY stock_lot_id
    `

    expect(movements).toEqual([
      { stock_lot_id: 'stl_older_date', delta: '-1.5', reason: 'count' },
      { stock_lot_id: 'stl_unknown_date', delta: '-2', reason: 'count' },
    ])
  })

  it('rejects a count for a food that is not a stock item', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_not_stock_item',
      name: 'Sample food not tracked in stock',
    })

    const error = await captureDomainError(
      stockService.countStock({
        foodMasterId: 'fm_not_stock_item',
        quantity: 1,
      }),
    )

    expect(error).toEqual({
      code: 'stock_item_not_found',
      details: { foodMasterId: 'fm_not_stock_item' },
    })
  })

  it('updates an existing delivery by source reference and replaces its items', async () => {
    const tx = getTx()
    for (const [foodMasterId, name] of [
      ['fm_delivery_a', 'Sample delivery food A'],
      ['fm_delivery_b', 'Sample delivery food B'],
      ['fm_delivery_c', 'Sample delivery food C'],
    ] as const) {
      await seedFoodMasterWithoutNutrition(tx, { id: foodMasterId, name })
      await seedStockItem(tx, { foodMasterId })
    }

    const first = await stockService.registerDelivery({
      sourceRef: 'sample-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      changeDeadline: '2026-10-18',
      items: [
        { foodMasterId: 'fm_delivery_a', quantity: 2 },
        { foodMasterId: 'fm_delivery_b', quantity: 1 },
      ],
    })
    first._unsafeUnwrap()
    const second = await stockService.registerDelivery({
      sourceRef: 'sample-order',
      status: 'planned',
      expectedDate: '2026-10-22',
      items: [
        { foodMasterId: 'fm_delivery_a', quantity: 3 },
        { foodMasterId: 'fm_delivery_c', quantity: 4 },
      ],
    })

    const result = await (async () => {
      const updated = second._unsafeUnwrap()
      const persistedItems = await tx<
        {
          id: string
          status: string
          expected_date: string
          change_deadline: string | null
          food_master_id: string
          quantity: string
        }[]
      >`
        SELECT d.id, d.status, d.expected_date::text AS expected_date,
               d.change_deadline::text AS change_deadline,
               sl.food_master_id, sl.quantity::text AS quantity
        FROM deliveries d
        JOIN stock_lots sl ON sl.delivery_id = d.id
        WHERE d.source_ref = 'sample-order'
        ORDER BY sl.food_master_id
      `
      return { updated, persistedItems }
    })()

    expect(result).toEqual({
      updated: {
        id: 'dly_test_0001',
        sourceRef: 'sample-order',
        status: 'planned',
        expectedDate: '2026-10-22',
        receivedDate: null,
        changeDeadline: null,
        items: [
          {
            foodMasterId: 'fm_delivery_a',
            foodName: 'Sample delivery food A',
            quantity: 3,
          },
          {
            foodMasterId: 'fm_delivery_c',
            foodName: 'Sample delivery food C',
            quantity: 4,
          },
        ],
      },
      persistedItems: [
        {
          id: 'dly_test_0001',
          status: 'planned',
          expected_date: '2026-10-22',
          change_deadline: null,
          food_master_id: 'fm_delivery_a',
          quantity: '3',
        },
        {
          id: 'dly_test_0001',
          status: 'planned',
          expected_date: '2026-10-22',
          change_deadline: null,
          food_master_id: 'fm_delivery_c',
          quantity: '4',
        },
      ],
    })
  })

  it('keeps planned quantities out of stock totals', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_planned_delivery',
      name: 'Sample planned delivery food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_planned_delivery' })
    await stockService.registerDelivery({
      sourceRef: 'sample-planned-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_planned_delivery', quantity: 3 }],
    })

    const status = await stockService.getStockStatus()

    expect(status._unsafeUnwrap()).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_planned_delivery',
          foodName: 'Sample planned delivery food',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 0,
          lots: [],
        },
      ],
      capacityWarnings: [],
      eatByWarnings: [],
      priorityLots: [],
      plannedDeliveries: [
        {
          id: 'dly_test_0001',
          sourceRef: 'sample-planned-order',
          expectedDate: '2026-10-20',
          changeDeadline: null,
          items: [
            {
              foodMasterId: 'fm_planned_delivery',
              foodName: 'Sample planned delivery food',
              quantity: 3,
            },
          ],
        },
      ],
    })
  })

  it('rejects delivery items outside stock management', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_not_stock_item',
      name: 'Sample untracked delivery food',
    })

    const error = await captureDomainError(
      stockService.registerDelivery({
        sourceRef: 'sample-invalid-order',
        status: 'planned',
        expectedDate: '2026-10-20',
        items: [{ foodMasterId: 'fm_not_stock_item', quantity: 1 }],
      }),
    )

    expect(error).toEqual({
      code: 'stock_item_not_found',
      details: { foodMasterId: 'fm_not_stock_item' },
    })
  })

  it('rolls back delivery registration when an item is not stock managed', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_untracked_delivery',
      name: 'Sample untracked delivery food',
    })
    await captureDomainError(
      stockService.registerDelivery({
        sourceRef: 'sample-rollback-order',
        status: 'planned',
        expectedDate: '2026-10-20',
        items: [{ foodMasterId: 'fm_untracked_delivery', quantity: 1 }],
      }),
    )
    const deliveries = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count
      FROM deliveries
      WHERE source_ref = 'sample-rollback-order'
    `

    expect(deliveries).toEqual([{ count: '0' }])
  })

  it('cancels a delivery and removes it from planned status', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_cancelled_delivery',
      name: 'Sample cancelled delivery food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_cancelled_delivery' })
    await stockService.registerDelivery({
      sourceRef: 'sample-cancel-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_cancelled_delivery', quantity: 2 }],
    })
    await stockService.registerDelivery({
      sourceRef: 'sample-cancel-order',
      status: 'cancelled',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_cancelled_delivery', quantity: 9 }],
    })

    const result = await (async () => {
      const status = (await stockService.getStockStatus())._unsafeUnwrap()
      const lots = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count
        FROM stock_lots
        WHERE delivery_id = 'dly_test_0001'
      `
      return { status, lots }
    })()

    expect(result).toEqual({
      status: {
        stockItems: [
          {
            foodMasterId: 'fm_cancelled_delivery',
            foodName: 'Sample cancelled delivery food',
            storageLocationId: null,
            storageLocation: null,
            eatWithinDays: null,
            totalQuantity: 0,
            lots: [],
          },
        ],
        plannedDeliveries: [],
        capacityWarnings: [],
        eatByWarnings: [],
        priorityLots: [],
      },
      lots: [{ count: '0' }],
    })
  })

  it('does not receive a cancelled delivery', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_cancelled_receipt',
      name: 'Sample cancelled receipt food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_cancelled_receipt' })
    await stockService.registerDelivery({
      sourceRef: 'sample-cancelled-receipt-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_cancelled_receipt', quantity: 2 }],
    })
    await stockService.registerDelivery({
      sourceRef: 'sample-cancelled-receipt-order',
      status: 'cancelled',
      expectedDate: '2026-10-20',
      items: [],
    })

    const result = await (async () => {
      const error = await captureDomainError(
        stockService.receiveDelivery({
          deliveryId: 'dly_test_0001',
          receivedDate: '2026-10-21',
        }),
      )
      const deliveryRows = await tx<
        {
          status: string
          received_date: string | null
          lot_count: string
          movement_count: string
        }[]
      >`
        SELECT d.status, d.received_date::text AS received_date,
               count(DISTINCT sl.id)::text AS lot_count,
               count(DISTINCT sm.id)::text AS movement_count
        FROM deliveries d
        LEFT JOIN stock_lots sl ON sl.delivery_id = d.id
        LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        WHERE d.id = 'dly_test_0001'
        GROUP BY d.id
      `
      return { error, deliveryRows }
    })()

    expect(result).toEqual({
      error: {
        code: 'delivery_not_planned',
        details: { deliveryId: 'dly_test_0001', status: 'cancelled' },
      },
      deliveryRows: [
        {
          status: 'cancelled',
          received_date: null,
          lot_count: '0',
          movement_count: '0',
        },
      ],
    })
  })

  it('adds received quantities to stock and derives eat-by dates', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_delivery_received',
      name: 'Sample received delivery food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_delivery_missing',
      name: 'Sample missing delivery food',
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_delivery_received',
      eatWithinDays: 10,
    })
    await seedStockItem(tx, { foodMasterId: 'fm_delivery_missing' })
    await stockService.registerDelivery({
      sourceRef: 'sample-receive-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [
        { foodMasterId: 'fm_delivery_received', quantity: 2.5 },
        { foodMasterId: 'fm_delivery_missing', quantity: 1 },
      ],
    })
    await stockService.receiveDelivery({
      deliveryId: 'dly_test_0001',
      receivedDate: '2026-10-21',
      items: [
        { foodMasterId: 'fm_delivery_received', quantity: 1.5 },
        { foodMasterId: 'fm_delivery_missing', quantity: 0 },
      ],
    })

    const status = await stockService.getStockStatus()

    expect(status._unsafeUnwrap()).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_delivery_missing',
          foodName: 'Sample missing delivery food',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 0,
          lots: [],
        },
        {
          foodMasterId: 'fm_delivery_received',
          foodName: 'Sample received delivery food',
          storageLocationId: null,
          storageLocation: null,
          eatWithinDays: 10,
          totalQuantity: 1.5,
          lots: [
            {
              id: 'stl_test_0002',
              quantity: 1.5,
              remainingQuantity: 1.5,
              receivedDate: '2026-10-21',
              bestBefore: null,
              eatBy: '2026-10-31',
            },
          ],
        },
      ],
      plannedDeliveries: [],
      capacityWarnings: [],
      eatByWarnings: [],
      priorityLots: [
        {
          foodMasterId: 'fm_delivery_received',
          foodName: 'Sample received delivery food',
          stockLotId: 'stl_test_0002',
          remainingQuantity: 1.5,
          targetDate: '2026-10-31',
          reasons: ['eat_by'],
        },
      ],
    })
  })

  it('rejects received items that are not part of the delivery', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_delivery_item',
      name: 'Sample delivery item food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_outside_delivery',
      name: 'Sample unrelated delivery food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_delivery_item' })
    await seedStockItem(tx, { foodMasterId: 'fm_outside_delivery' })
    await stockService.registerDelivery({
      sourceRef: 'sample-item-check-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_delivery_item', quantity: 2 }],
    })

    const result = await (async () => {
      const error = await captureDomainError(
        stockService.receiveDelivery({
          deliveryId: 'dly_test_0001',
          receivedDate: '2026-10-21',
          items: [{ foodMasterId: 'fm_outside_delivery', quantity: 1 }],
        }),
      )
      const deliveryRows = await tx<
        {
          status: string
          received_date: string | null
          movement_count: string
        }[]
      >`
        SELECT d.status, d.received_date::text AS received_date,
               count(sm.id)::text AS movement_count
        FROM deliveries d
        LEFT JOIN stock_lots sl ON sl.delivery_id = d.id
        LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        WHERE d.id = 'dly_test_0001'
        GROUP BY d.id
      `
      return { error, deliveryRows }
    })()

    expect(result).toEqual({
      error: {
        code: 'delivery_item_not_found',
        details: {
          deliveryId: 'dly_test_0001',
          foodMasterId: 'fm_outside_delivery',
        },
      },
      deliveryRows: [
        { status: 'planned', received_date: null, movement_count: '0' },
      ],
    })
  })

  it('records the receipt date and a receive movement', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_delivery_movement',
      name: 'Sample delivery movement food',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_delivery_movement' })
    await stockService.registerDelivery({
      sourceRef: 'sample-movement-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_delivery_movement', quantity: 2 }],
    })
    await stockService.receiveDelivery({
      deliveryId: 'dly_test_0001',
      receivedDate: '2026-10-21',
    })
    const result = await (async () => {
      const secondReceiptError = await captureDomainError(
        stockService.receiveDelivery({
          deliveryId: 'dly_test_0001',
          receivedDate: '2026-10-21',
        }),
      )
      const receiptRows = await tx<
        {
          status: string
          received_date: string | null
          lot_received_date: string | null
          eat_by: string | null
          delta: string
          reason: string
          movement_count: string
        }[]
      >`
        SELECT d.status, d.received_date::text AS received_date,
               sl.received_date::text AS lot_received_date,
               sl.eat_by::text AS eat_by, min(sm.delta)::text AS delta,
               min(sm.reason) AS reason, count(sm.id)::text AS movement_count
        FROM deliveries d
        JOIN stock_lots sl ON sl.delivery_id = d.id
        JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        WHERE d.id = 'dly_test_0001'
        GROUP BY d.id, sl.id
      `
      return { secondReceiptError, receiptRows }
    })()

    expect(result).toEqual({
      secondReceiptError: {
        code: 'delivery_not_planned',
        details: { deliveryId: 'dly_test_0001', status: 'received' },
      },
      receiptRows: [
        {
          status: 'received',
          received_date: '2026-10-21',
          lot_received_date: '2026-10-21',
          eat_by: null,
          delta: '2',
          reason: 'receive',
          movement_count: '1',
        },
      ],
    })
  })

  it('rejects re-registering a received delivery without changing its stock', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_received_delivery_update',
      name: 'Sample received delivery update food',
    })
    await seedStockItem(tx, {
      foodMasterId: 'fm_received_delivery_update',
      eatWithinDays: 8,
    })
    await stockService.registerDelivery({
      sourceRef: 'sample-received-update-order',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_received_delivery_update', quantity: 2 }],
    })
    await stockService.receiveDelivery({
      deliveryId: 'dly_test_0001',
      receivedDate: '2026-10-21',
      items: [{ foodMasterId: 'fm_received_delivery_update', quantity: 1.5 }],
    })

    const result = await (async () => {
      const error = await captureDomainError(
        stockService.registerDelivery({
          sourceRef: 'sample-received-update-order',
          status: 'planned',
          expectedDate: '2026-10-25',
          items: [{ foodMasterId: 'fm_received_delivery_update', quantity: 9 }],
        }),
      )
      const rows = await tx<
        {
          status: string
          expected_date: string
          received_date: string | null
          quantity: string
          lot_received_date: string | null
          eat_by: string | null
          movement_count: string
        }[]
      >`
        SELECT d.status, d.expected_date::text AS expected_date,
               d.received_date::text AS received_date,
               sl.quantity::text AS quantity,
               sl.received_date::text AS lot_received_date,
               sl.eat_by::text AS eat_by,
               count(sm.id)::text AS movement_count
        FROM deliveries d
        JOIN stock_lots sl ON sl.delivery_id = d.id
        LEFT JOIN stock_movements sm ON sm.stock_lot_id = sl.id
        WHERE d.id = 'dly_test_0001'
        GROUP BY d.id, sl.id
      `
      return { error, rows }
    })()

    expect(result).toEqual({
      error: {
        code: 'delivery_not_planned',
        details: { deliveryId: 'dly_test_0001' },
      },
      rows: [
        {
          status: 'received',
          expected_date: '2026-10-20',
          received_date: '2026-10-21',
          quantity: '1.5',
          lot_received_date: '2026-10-21',
          eat_by: '2026-10-29',
          movement_count: '1',
        },
      ],
    })
  })

  it('does not expose cancelled deliveries as planned', async () => {
    const tx = getTx()
    await seedDelivery(tx, {
      id: 'dly_seeded_cancelled',
      status: 'cancelled',
      expectedDate: '2026-10-20',
    })

    const status = await stockService.getStockStatus()

    expect(status._unsafeUnwrap()).toEqual({
      stockItems: [],
      plannedDeliveries: [],
      capacityWarnings: [],
      eatByWarnings: [],
      priorityLots: [],
    })
  })
})
