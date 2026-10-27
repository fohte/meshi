import { expect, it } from 'vitest'

import { createDrizzleStockRepository } from '#domain/stock/drizzle-stock-repository'
import { createStockService } from '#domain/stock/stock-service'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedDelivery,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
  seedStockLot,
  seedStockMovement,
} from '#test/seed'

describeIfDb('stock delivery reader', () => {
  const getTx = setupDrizzleTx()

  it('returns all statuses in effective-date order with consumed and pending lots', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_delivery_reader',
      name: 'Sample grain packet',
    })
    await seedDelivery(tx, {
      id: 'dly_received_reader',
      sourceRef: 'ref_received_reader',
      status: 'received',
      expectedDate: '2031-05-10',
      receivedDate: '2031-05-02',
      changeDeadline: '2031-05-08',
    })
    await seedStockLot(tx, {
      id: 'stl_consumed_reader',
      foodMasterId: 'fm_delivery_reader',
      deliveryId: 'dly_received_reader',
      quantity: 3,
      receivedDate: '2031-05-02',
    })
    await seedMealLog(tx, {
      id: 'ml_consumed_reader',
      foodMasterId: 'fm_delivery_reader',
      eatenDate: jstDate('2031-05-02'),
      mealType: 'lunch',
      quantity: 3,
    })
    await seedStockMovement(tx, {
      id: 'stm_received_reader',
      stockLotId: 'stl_consumed_reader',
      delta: 3,
      reason: 'receive',
    })
    await seedStockMovement(tx, {
      id: 'stm_consumed_reader',
      stockLotId: 'stl_consumed_reader',
      delta: -3,
      reason: 'meal',
      mealLogId: 'ml_consumed_reader',
    })
    await seedDelivery(tx, {
      id: 'dly_planned_reader',
      sourceRef: 'ref_planned_reader',
      status: 'planned',
      expectedDate: '2031-05-03',
    })
    await seedStockLot(tx, {
      id: 'stl_planned_reader',
      foodMasterId: 'fm_delivery_reader',
      deliveryId: 'dly_planned_reader',
      quantity: 2,
    })
    await seedDelivery(tx, {
      id: 'dly_cancelled_reader',
      sourceRef: 'ref_cancelled_reader',
      status: 'cancelled',
      expectedDate: '2031-05-01',
    })

    const stockService = createStockService(
      createDrizzleStockRepository(tx, { wrapInTransaction: false }),
    )
    const result = await stockService.listDeliveries({ limit: 20 })

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'dly_planned_reader',
        sourceRef: 'ref_planned_reader',
        status: 'planned',
        expectedDate: '2031-05-03',
        receivedDate: null,
        changeDeadline: null,
        items: [
          {
            foodMasterId: 'fm_delivery_reader',
            foodName: 'Sample grain packet',
            stockLotId: 'stl_planned_reader',
            quantity: 2,
            remainingQuantity: null,
          },
        ],
      },
      {
        id: 'dly_received_reader',
        sourceRef: 'ref_received_reader',
        status: 'received',
        expectedDate: '2031-05-10',
        receivedDate: '2031-05-02',
        changeDeadline: '2031-05-08',
        items: [
          {
            foodMasterId: 'fm_delivery_reader',
            foodName: 'Sample grain packet',
            stockLotId: 'stl_consumed_reader',
            quantity: 3,
            remainingQuantity: 0,
          },
        ],
      },
      {
        id: 'dly_cancelled_reader',
        sourceRef: 'ref_cancelled_reader',
        status: 'cancelled',
        expectedDate: '2031-05-01',
        receivedDate: null,
        changeDeadline: null,
        items: [],
      },
    ])
  })

  it('uses delivery id and current source reference together', async () => {
    const tx = getTx()
    await seedDelivery(tx, {
      id: 'dly_filter_target',
      sourceRef: 'ref_filter_target',
      status: 'received',
      expectedDate: '2031-06-01',
      receivedDate: '2031-06-02',
    })
    await seedDelivery(tx, {
      id: 'dly_filter_other',
      sourceRef: 'ref_filter_other',
      status: 'received',
      expectedDate: '2031-06-03',
      receivedDate: '2031-06-03',
    })

    const stockService = createStockService(
      createDrizzleStockRepository(tx, { wrapInTransaction: false }),
    )
    const result = await stockService.listDeliveries({
      deliveryId: 'dly_filter_target',
      sourceRef: 'ref_filter_target',
      status: 'received',
      limit: 50,
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'dly_filter_target',
        sourceRef: 'ref_filter_target',
        status: 'received',
        expectedDate: '2031-06-01',
        receivedDate: '2031-06-02',
        changeDeadline: null,
        items: [],
      },
    ])
  })

  it('filters deliveries by status', async () => {
    const tx = getTx()
    await seedDelivery(tx, {
      id: 'dly_status_received',
      sourceRef: 'ref_status_received',
      status: 'received',
      expectedDate: '2031-06-04',
      receivedDate: '2031-06-05',
    })
    await seedDelivery(tx, {
      id: 'dly_status_planned',
      sourceRef: 'ref_status_planned',
      status: 'planned',
      expectedDate: '2031-06-06',
    })

    const stockService = createStockService(
      createDrizzleStockRepository(tx, { wrapInTransaction: false }),
    )
    const result = await stockService.listDeliveries({
      status: 'received',
      limit: 50,
    })

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'dly_status_received',
        sourceRef: 'ref_status_received',
        status: 'received',
        expectedDate: '2031-06-04',
        receivedDate: '2031-06-05',
        changeDeadline: null,
        items: [],
      },
    ])
  })

  it('limits results after sorting by the effective date', async () => {
    const tx = getTx()
    await seedDelivery(tx, {
      id: 'dly_limit_older',
      sourceRef: 'ref_limit_older',
      status: 'planned',
      expectedDate: '2031-07-01',
    })
    await seedDelivery(tx, {
      id: 'dly_limit_newer',
      sourceRef: 'ref_limit_newer',
      status: 'cancelled',
      expectedDate: '2031-07-02',
    })

    const stockService = createStockService(
      createDrizzleStockRepository(tx, { wrapInTransaction: false }),
    )
    const result = await stockService.listDeliveries({ limit: 1 })

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'dly_limit_newer',
        sourceRef: 'ref_limit_newer',
        status: 'cancelled',
        expectedDate: '2031-07-02',
        receivedDate: null,
        changeDeadline: null,
        items: [],
      },
    ])
  })
})
