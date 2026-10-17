import { beforeEach, expect, it } from 'vitest'

import { createDrizzleStockRepository } from '#domain/stock/drizzle-stock-repository'
import { createStockService } from '#domain/stock/stock-service'
import type { StockService } from '#domain/stock/types'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import {
  seedDelivery,
  seedFoodMasterWithoutNutrition,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
} from '#test/seed'

describeIfDb('stock repository', () => {
  const getTx = setupTx()
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

    expect(second._unsafeUnwrap()).toEqual({
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
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 0,
          lots: [],
        },
      ],
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
      items: [],
    })

    const status = await stockService.getStockStatus()

    expect(status._unsafeUnwrap()).toEqual({
      stockItems: [
        {
          foodMasterId: 'fm_cancelled_delivery',
          foodName: 'Sample cancelled delivery food',
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 0,
          lots: [],
        },
      ],
      plannedDeliveries: [],
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
          storageLocation: null,
          eatWithinDays: null,
          totalQuantity: 0,
          lots: [],
        },
        {
          foodMasterId: 'fm_delivery_received',
          foodName: 'Sample received delivery food',
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
    await captureDomainError(
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
      }[]
    >`
      SELECT d.status, d.received_date::text AS received_date,
             sl.received_date::text AS lot_received_date,
             sl.eat_by::text AS eat_by, sm.delta::text AS delta, sm.reason
      FROM deliveries d
      JOIN stock_lots sl ON sl.delivery_id = d.id
      JOIN stock_movements sm ON sm.stock_lot_id = sl.id
      WHERE d.id = 'dly_test_0001'
    `

    expect(receiptRows).toEqual([
      {
        status: 'received',
        received_date: '2026-10-21',
        lot_received_date: '2026-10-21',
        eat_by: null,
        delta: '2',
        reason: 'receive',
      },
    ])
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
    })
  })
})
