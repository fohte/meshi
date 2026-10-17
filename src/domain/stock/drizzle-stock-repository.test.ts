import { beforeEach, expect, it } from 'vitest'

import { createDrizzleStockRepository } from '#domain/stock/drizzle-stock-repository'
import { createStockService } from '#domain/stock/stock-service'
import type { StockService } from '#domain/stock/types'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import {
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

    expect(status).toEqual([
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
    ])
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
      remainingQuantity: 1.5,
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
})
