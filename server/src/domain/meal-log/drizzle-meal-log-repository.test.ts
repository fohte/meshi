import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { expect, it } from 'vitest'

import type { Sql } from '#db/index'
import {
  foodMasterNutrition,
  foodMasters,
  mealLogs,
  stockLots,
  stockMovements,
} from '#db/schema'
import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import {
  FoodMasterNotFoundError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { FoundMealLog } from '#domain/meal-log/meal-log-repository'
import type { FoodMasterRef, MealLogRow } from '#domain/meal-log/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMaster,
  seedFoodMasterWithoutNutrition,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
} from '#test/seed'

const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const observation = <T extends object>(value: T): T => value

const normalizeRow = (row: MealLogRow): MealLogRow => ({
  ...row,
  createdAt: CREATED_AT_PLACEHOLDER,
})

const normalizeFoodAndMealLog = (
  food: FoodMasterRef,
  fetched: FoundMealLog | null,
) => ({
  food,
  mealLog:
    fetched === null
      ? null
      : { log: normalizeRow(fetched.log), food: fetched.food },
})

const readMealMovements = async (tx: Sql, mealLogId: string) => {
  const rows = await drizzle(tx)
    .select({
      stockLotId: stockMovements.stockLotId,
      delta: stockMovements.delta,
      reason: stockMovements.reason,
      mealLogId: stockMovements.mealLogId,
    })
    .from(stockMovements)
    .where(eq(stockMovements.mealLogId, mealLogId))
    .orderBy(asc(stockMovements.stockLotId))

  return rows.map((row) => ({
    ...row,
    delta: Number(row.delta),
  }))
}

const readNutritionVersionReferences = async (
  tx: Sql,
  mealLogIds: ReadonlyArray<string>,
) => {
  const rows = await drizzle(tx)
    .select({
      id: mealLogs.id,
      nutritionVersionId: mealLogs.nutritionVersionId,
      nutritionVersionOrigin: mealLogs.nutritionVersionOrigin,
      currentVersionId: foodMasterNutrition.id,
    })
    .from(mealLogs)
    .innerJoin(foodMasters, eq(foodMasters.id, mealLogs.foodMasterId))
    .leftJoin(
      foodMasterNutrition,
      and(
        eq(foodMasterNutrition.foodMasterId, foodMasters.id),
        eq(foodMasterNutrition.isCurrent, true),
      ),
    )
    .where(inArray(mealLogs.id, mealLogIds))
    .orderBy(asc(mealLogs.id))

  return rows.map((row) => ({
    id: row.id,
    nutritionVersionId:
      row.nutritionVersionId === null
        ? null
        : row.nutritionVersionId === row.currentVersionId
          ? '<current>'
          : row.nutritionVersionId,
    currentVersionId: row.currentVersionId === null ? null : '<current>',
    nutritionVersionOrigin: row.nutritionVersionOrigin,
  }))
}

const readLotBalances = async (tx: Sql, foodMasterId: string) => {
  const rows = await drizzle(tx)
    .select({
      stockLotId: stockLots.id,
      remaining: sql<string>`COALESCE(SUM(${stockMovements.delta}), 0)::text`,
    })
    .from(stockLots)
    .leftJoin(stockMovements, eq(stockMovements.stockLotId, stockLots.id))
    .where(eq(stockLots.foodMasterId, foodMasterId))
    .groupBy(stockLots.id, stockLots.receivedDate, stockLots.createdAt)
    .orderBy(
      sql`${stockLots.receivedDate} ASC NULLS FIRST`,
      asc(stockLots.createdAt),
      asc(stockLots.id),
    )

  return rows.map((row) => ({
    stockLotId: row.stockLotId,
    remaining: Number(row.remaining),
  }))
}

describeIfDb('createDrizzleMealLogRepository', () => {
  const getTx = setupDrizzleTx()

  it('returns a FoodMasterNotFoundError when the food_master_id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)
    const error = (
      await repo.findFoodMaster('fm_does_not_exist')
    )._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(FoodMasterNotFoundError)
    expect(
      error instanceof FoodMasterNotFoundError ? error.foodMasterId : undefined,
    ).toBe('fm_does_not_exist')
  })

  it('round-trips a meal log through insertMealLog + findMealLogById', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLog({
        id: 'ml_round',
        foodMasterId: 'fm_rice',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'breakfast',
        quantity: 150,
      })
    )._unsafeUnwrap()
    const fetched = (await repo.findMealLogById('ml_round'))._unsafeUnwrap()

    const expectedRow: MealLogRow = {
      id: 'ml_round',
      foodMasterId: 'fm_rice',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'breakfast',
      quantity: 150,
      createdAt: CREATED_AT_PLACEHOLDER,
    }

    expect(normalizeRow(inserted)).toEqual(expectedRow)
    expect(
      fetched === null
        ? null
        : { log: normalizeRow(fetched.log), food: fetched.food },
    ).toEqual({
      log: expectedRow,
      food: {
        id: 'fm_rice',
        name: '白米',
        isEstimated: false,
        nutritionStatus: 'confirmed',
        nutritionPerUnit: {
          protein_g: 2.5,
          carb_g: 37.1,
        },
      },
    })
  })

  it('records the current nutrition version for a single meal log', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_recorded_single',
      name: 'Nutrition item',
      source: 'user_input',
      nutrients: { energy_kcal: 100 },
    })
    const repo = createDrizzleMealLogRepository(tx)

    await repo.insertMealLog({
      id: 'ml_recorded_single',
      foodMasterId: 'fm_recorded_single',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'breakfast',
      quantity: 1,
    })

    expect(
      await readNutritionVersionReferences(tx, ['ml_recorded_single']),
    ).toEqual([
      {
        id: 'ml_recorded_single',
        nutritionVersionId: '<current>',
        currentVersionId: '<current>',
        nutritionVersionOrigin: 'recorded',
      },
    ])
  })

  it('records current and unknown nutrition versions in a meal-log batch', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_recorded_batch_known',
      name: 'Known nutrition item',
      source: 'user_input',
      nutrients: { energy_kcal: 100 },
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_recorded_batch_unknown',
      name: 'Unknown nutrition item',
    })
    const repo = createDrizzleMealLogRepository(tx)

    await repo.insertMealLogs([
      {
        id: 'ml_recorded_batch_known',
        foodMasterId: 'fm_recorded_batch_known',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 1,
      },
      {
        id: 'ml_recorded_batch_unknown',
        foodMasterId: 'fm_recorded_batch_unknown',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 1,
      },
    ])

    expect(
      await readNutritionVersionReferences(tx, [
        'ml_recorded_batch_known',
        'ml_recorded_batch_unknown',
      ]),
    ).toEqual([
      {
        id: 'ml_recorded_batch_known',
        nutritionVersionId: '<current>',
        currentVersionId: '<current>',
        nutritionVersionOrigin: 'recorded',
      },
      {
        id: 'ml_recorded_batch_unknown',
        nutritionVersionId: null,
        currentVersionId: null,
        nutritionVersionOrigin: 'recorded',
      },
    ])
  })

  it('consumes fractional stock from the oldest lots and reports the shortfall', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_fifo',
      name: 'Sample stock item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_fifo' })
    for (const lot of [
      { id: 'stl_stock_unknown', receivedDate: null, quantity: 1 },
      { id: 'stl_stock_old', receivedDate: '2026-01-01', quantity: 1 },
      { id: 'stl_stock_new', receivedDate: '2026-02-01', quantity: 0.25 },
    ]) {
      await seedStockLot(tx, {
        id: lot.id,
        foodMasterId: 'fm_stock_fifo',
        quantity: lot.quantity,
        receivedDate: lot.receivedDate,
      })
      await seedStockMovement(tx, {
        id: `stm_opening_${lot.id}`,
        stockLotId: lot.id,
        delta: lot.quantity,
        reason: 'count',
      })
    }
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLog({
        id: 'ml_stock_fifo',
        foodMasterId: 'fm_stock_fifo',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 2.5,
      })
    )._unsafeUnwrap()
    const movements = await readMealMovements(tx, 'ml_stock_fifo')
    const balances = await readLotBalances(tx, 'fm_stock_fifo')

    expect(
      observation({
        stockShortfall: inserted.stockShortfall,
        movements,
        balances,
      }),
    ).toEqual({
      stockShortfall: 0.25,
      movements: [
        {
          stockLotId: 'stl_stock_new',
          delta: -0.25,
          reason: 'meal',
          mealLogId: 'ml_stock_fifo',
        },
        {
          stockLotId: 'stl_stock_old',
          delta: -1,
          reason: 'meal',
          mealLogId: 'ml_stock_fifo',
        },
        {
          stockLotId: 'stl_stock_unknown',
          delta: -1,
          reason: 'meal',
          mealLogId: 'ml_stock_fifo',
        },
      ],
      balances: [
        { stockLotId: 'stl_stock_unknown', remaining: 0 },
        { stockLotId: 'stl_stock_old', remaining: 0 },
        { stockLotId: 'stl_stock_new', remaining: 0 },
      ],
    })
  })

  it('reports the full quantity as a shortfall when a tracked item has no lots', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_no_lots',
      name: 'Sample item without lots',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_no_lots' })
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLog({
        id: 'ml_stock_no_lots',
        foodMasterId: 'fm_stock_no_lots',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 1.25,
      })
    )._unsafeUnwrap()

    expect(
      observation({
        stockShortfall: inserted.stockShortfall,
        movements: await readMealMovements(tx, 'ml_stock_no_lots'),
        balances: await readLotBalances(tx, 'fm_stock_no_lots'),
      }),
    ).toEqual({ stockShortfall: 1.25, movements: [], balances: [] })
  })

  it('replaces stock movements when the meal quantity changes', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_quantity',
      name: 'Sample quantity item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_quantity' })
    await seedStockLot(tx, {
      id: 'stl_stock_quantity',
      foodMasterId: 'fm_stock_quantity',
      quantity: 3,
    })
    await seedStockMovement(tx, {
      id: 'stm_stock_quantity_opening',
      stockLotId: 'stl_stock_quantity',
      delta: 3,
      reason: 'count',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_stock_quantity',
      foodMasterId: 'fm_stock_quantity',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 1,
    })

    const updated = (
      await repo.updateMealLog({ id: 'ml_stock_quantity', quantity: 1.5 })
    )._unsafeUnwrap()
    const movements = await readMealMovements(tx, 'ml_stock_quantity')
    const balances = await readLotBalances(tx, 'fm_stock_quantity')

    expect(
      observation({
        stockShortfall: updated.stockShortfall,
        movements,
        balances,
      }),
    ).toEqual({
      stockShortfall: 0,
      movements: [
        {
          stockLotId: 'stl_stock_quantity',
          delta: -1.5,
          reason: 'meal',
          mealLogId: 'ml_stock_quantity',
        },
      ],
      balances: [{ stockLotId: 'stl_stock_quantity', remaining: 1.5 }],
    })
  })

  it('moves stock consumption when the meal food changes', async () => {
    const tx = getTx()
    for (const { foodMasterId, name } of [
      { foodMasterId: 'fm_stock_before', name: 'Sample stock item before' },
      { foodMasterId: 'fm_stock_after', name: 'Sample stock item after' },
    ]) {
      await seedFoodMasterWithoutNutrition(tx, {
        id: foodMasterId,
        name,
      })
      await seedStockItem(tx, { foodMasterId })
      const stockLotId = `stl_${foodMasterId}`
      await seedStockLot(tx, { id: stockLotId, foodMasterId, quantity: 2 })
      await seedStockMovement(tx, {
        id: `stm_${foodMasterId}_opening`,
        stockLotId,
        delta: 2,
        reason: 'count',
      })
    }
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_stock_food_change',
      foodMasterId: 'fm_stock_before',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 1.5,
    })

    const updated = (
      await repo.updateMealLog({
        id: 'ml_stock_food_change',
        foodMasterId: 'fm_stock_after',
      })
    )._unsafeUnwrap()
    const movements = await readMealMovements(tx, 'ml_stock_food_change')
    const balances = await Promise.all([
      readLotBalances(tx, 'fm_stock_before'),
      readLotBalances(tx, 'fm_stock_after'),
    ])

    expect(
      observation({
        stockShortfall: updated.stockShortfall,
        movements,
        balances,
      }),
    ).toEqual({
      stockShortfall: 0,
      movements: [
        {
          stockLotId: 'stl_fm_stock_after',
          delta: -1.5,
          reason: 'meal',
          mealLogId: 'ml_stock_food_change',
        },
      ],
      balances: [
        [{ stockLotId: 'stl_fm_stock_before', remaining: 2 }],
        [{ stockLotId: 'stl_fm_stock_after', remaining: 0.5 }],
      ],
    })
  })

  it('consumes stock in input order for an atomic batch', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_batch',
      name: 'Sample batch item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_batch' })
    for (const [id, quantity] of [
      ['stl_stock_batch_first', 1.5],
      ['stl_stock_batch_second', 1],
    ] as const) {
      await seedStockLot(tx, {
        id,
        foodMasterId: 'fm_stock_batch',
        quantity,
      })
      await seedStockMovement(tx, {
        id: `stm_opening_${id}`,
        stockLotId: id,
        delta: quantity,
        reason: 'count',
      })
    }
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLogs([
        {
          id: 'ml_stock_batch_first',
          foodMasterId: 'fm_stock_batch',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'lunch',
          quantity: 1.25,
        },
        {
          id: 'ml_stock_batch_second',
          foodMasterId: 'fm_stock_batch',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'lunch',
          quantity: 1,
        },
      ])
    )._unsafeUnwrap()
    const movements = await Promise.all(
      inserted.map((row) => readMealMovements(tx, row.id)),
    )

    expect(
      observation({
        shortfalls: inserted.map((row) => row.stockShortfall),
        movements,
      }),
    ).toEqual({
      shortfalls: [0, 0],
      movements: [
        [
          {
            stockLotId: 'stl_stock_batch_first',
            delta: -1.25,
            reason: 'meal',
            mealLogId: 'ml_stock_batch_first',
          },
        ],
        [
          {
            stockLotId: 'stl_stock_batch_first',
            delta: -0.25,
            reason: 'meal',
            mealLogId: 'ml_stock_batch_second',
          },
          {
            stockLotId: 'stl_stock_batch_second',
            delta: -0.75,
            reason: 'meal',
            mealLogId: 'ml_stock_batch_second',
          },
        ],
      ],
    })
  })

  it('rolls back all meal and stock writes when stock movement creation fails', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_atomic',
      name: 'Sample atomic item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_atomic' })
    for (const suffix of ['first', 'second']) {
      const stockLotId = `stl_stock_atomic_${suffix}`
      await seedStockLot(tx, {
        id: stockLotId,
        foodMasterId: 'fm_stock_atomic',
        quantity: 1,
      })
      await seedStockMovement(tx, {
        id: `stm_stock_atomic_${suffix}`,
        stockLotId,
        delta: 1,
        reason: 'count',
      })
    }
    const repo = createDrizzleMealLogRepository(tx, {
      generateId: () => 'stm_duplicate',
    })

    const result = await repo.insertMealLogs([
      {
        id: 'ml_stock_atomic_first',
        foodMasterId: 'fm_stock_atomic',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 1,
      },
      {
        id: 'ml_stock_atomic_second',
        foodMasterId: 'fm_stock_atomic',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 1,
      },
    ])
    const remainingLogs = await Promise.all([
      repo.findMealLogById('ml_stock_atomic_first'),
      repo.findMealLogById('ml_stock_atomic_second'),
    ])
    const movements = await Promise.all([
      readMealMovements(tx, 'ml_stock_atomic_first'),
      readMealMovements(tx, 'ml_stock_atomic_second'),
    ])

    expect(
      observation({
        errorCode: result.isErr() ? result.error.code : null,
        remainingLogs: remainingLogs.map(
          (entry) => entry._unsafeUnwrap()?.log.id ?? null,
        ),
        movements,
      }),
    ).toEqual({
      errorCode: 'meal_log/persistence_failed',
      remainingLogs: [null, null],
      movements: [[], []],
    })
  })

  it('restores the previous meal and stock movements when an update sync fails', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_update_rollback',
      name: 'Sample update rollback item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_update_rollback' })
    await seedStockLot(tx, {
      id: 'stl_stock_update_rollback',
      foodMasterId: 'fm_stock_update_rollback',
      quantity: 2,
    })
    await seedStockMovement(tx, {
      id: 'stm_stock_update_opening',
      stockLotId: 'stl_stock_update_rollback',
      delta: 2,
      reason: 'count',
    })
    let generatedMovementCount = 0
    const repo = createDrizzleMealLogRepository(tx, {
      generateId: () => {
        generatedMovementCount += 1
        return generatedMovementCount === 1
          ? 'stm_stock_update_initial'
          : 'stm_stock_update_opening'
      },
    })
    await repo.insertMealLog({
      id: 'ml_stock_update_rollback',
      foodMasterId: 'fm_stock_update_rollback',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 0.5,
    })

    const result = await repo.updateMealLog({
      id: 'ml_stock_update_rollback',
      quantity: 1.5,
    })
    const current = (
      await repo.findMealLogById('ml_stock_update_rollback')
    )._unsafeUnwrap()

    expect(
      observation({
        errorCode: result.isErr() ? result.error.code : null,
        mealLog: current === null ? null : normalizeRow(current.log),
        movements: await readMealMovements(tx, 'ml_stock_update_rollback'),
        balances: await readLotBalances(tx, 'fm_stock_update_rollback'),
      }),
    ).toEqual({
      errorCode: 'meal_log/persistence_failed',
      mealLog: {
        id: 'ml_stock_update_rollback',
        foodMasterId: 'fm_stock_update_rollback',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity: 0.5,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      movements: [
        {
          stockLotId: 'stl_stock_update_rollback',
          delta: -0.5,
          reason: 'meal',
          mealLogId: 'ml_stock_update_rollback',
        },
      ],
      balances: [{ stockLotId: 'stl_stock_update_rollback', remaining: 1.5 }],
    })
  })

  it('deletes meal stock movements through the foreign key cascade', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_stock_delete',
      name: 'Sample delete item',
    })
    await seedStockItem(tx, { foodMasterId: 'fm_stock_delete' })
    await seedStockLot(tx, {
      id: 'stl_stock_delete',
      foodMasterId: 'fm_stock_delete',
      quantity: 1,
    })
    await seedStockMovement(tx, {
      id: 'stm_stock_delete_opening',
      stockLotId: 'stl_stock_delete',
      delta: 1,
      reason: 'count',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_stock_delete',
      foodMasterId: 'fm_stock_delete',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 1,
    })

    const deleted = await repo.deleteMealLog('ml_stock_delete')
    const movements = await readMealMovements(tx, 'ml_stock_delete')

    expect(
      observation({ deleted: deleted._unsafeUnwrap(), movements }),
    ).toEqual({ deleted: true, movements: [] })
  })

  it('finds and returns a meal log for a food without nutrition metadata', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_unknown',
      name: 'unknown menu item',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_unknown',
      foodMasterId: 'fm_unknown',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'dinner',
      quantity: 1,
    })
    const food = (await repo.findFoodMaster('fm_unknown'))._unsafeUnwrap()
    const fetched = (await repo.findMealLogById('ml_unknown'))._unsafeUnwrap()

    expect(normalizeFoodAndMealLog(food, fetched)).toEqual({
      food: {
        id: 'fm_unknown',
        name: 'unknown menu item',
        isEstimated: false,
        nutritionStatus: 'unknown',
        nutritionPerUnit: {},
      },
      mealLog: {
        log: {
          id: 'ml_unknown',
          foodMasterId: 'fm_unknown',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'dinner',
          quantity: 1,
          createdAt: CREATED_AT_PLACEHOLDER,
        },
        food: {
          id: 'fm_unknown',
          name: 'unknown menu item',
          isEstimated: false,
          nutritionStatus: 'unknown',
          nutritionPerUnit: {},
        },
      },
    })
  })

  it('inserts multiple meal logs together and returns each inserted row', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_batch_alpha',
      name: 'item_token_alpha',
      isEstimated: false,
      source: 'user_input',
    })
    await seedFoodMaster(tx, {
      id: 'fm_batch_beta',
      name: 'item_token_beta',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLogs([
        {
          id: 'ml_batch_alpha',
          foodMasterId: 'fm_batch_alpha',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'dinner',
          quantity: 1,
        },
        {
          id: 'ml_batch_beta',
          foodMasterId: 'fm_batch_beta',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'dinner',
          quantity: 2,
        },
      ])
    )._unsafeUnwrap()

    expect(inserted.map(normalizeRow)).toEqual([
      {
        id: 'ml_batch_alpha',
        foodMasterId: 'fm_batch_alpha',
        eatenDate: '2026-06-15',
        mealType: 'dinner',
        quantity: 1,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      {
        id: 'ml_batch_beta',
        foodMasterId: 'fm_batch_beta',
        eatenDate: '2026-06-15',
        mealType: 'dinner',
        quantity: 2,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
    ])
  })

  it('returns null from findMealLogById when the id is unknown', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)
    expect(
      (await repo.findMealLogById('ml_missing'))._unsafeUnwrap(),
    ).toBeNull()
  })

  it('updateMealLog patches only the given fields and leaves the rest untouched', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_patch',
      foodMasterId: 'fm_rice',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'breakfast',
      quantity: 150,
    })

    // foodMasterId/eatenDate/mealType are all omitted from this patch — this
    // test's whole point is that fields absent from the patch are left
    // untouched.
    const updated = (
      await repo.updateMealLog({
        id: 'ml_patch',
        quantity: 200,
      })
    )._unsafeUnwrap()

    expect(
      observation({
        row: normalizeRow(updated),
        nutritionVersionReferences: await readNutritionVersionReferences(tx, [
          'ml_patch',
        ]),
      }),
    ).toEqual({
      row: {
        id: 'ml_patch',
        foodMasterId: 'fm_rice',
        eatenDate: '2026-06-15',
        mealType: 'breakfast',
        quantity: 200,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      nutritionVersionReferences: [
        {
          id: 'ml_patch',
          nutritionVersionId: '<current>',
          currentVersionId: '<current>',
          nutritionVersionOrigin: 'recorded',
        },
      ],
    })
  })

  it('updateMealLog re-points food_master_id at another existing food_master', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    await seedFoodMaster(tx, {
      id: 'fm_karaage',
      name: '唐揚げ',
      isEstimated: true,
      source: 'user_input',
      nutrients: { protein_g: 24.2, carb_g: 7.9 },
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_repoint',
      foodMasterId: 'fm_rice',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 100,
    })

    await repo.updateMealLog({ id: 'ml_repoint', foodMasterId: 'fm_karaage' })
    const fetched = (await repo.findMealLogById('ml_repoint'))._unsafeUnwrap()

    expect(
      observation({
        fetched:
          fetched === null
            ? null
            : { log: normalizeRow(fetched.log), food: fetched.food },
        nutritionVersionReferences: await readNutritionVersionReferences(tx, [
          'ml_repoint',
        ]),
      }),
    ).toEqual({
      fetched: {
        log: {
          id: 'ml_repoint',
          foodMasterId: 'fm_karaage',
          eatenDate: '2026-06-15',
          mealType: 'lunch',
          quantity: 100,
          createdAt: CREATED_AT_PLACEHOLDER,
        },
        food: {
          id: 'fm_karaage',
          name: '唐揚げ',
          isEstimated: true,
          nutritionStatus: 'estimated',
          nutritionPerUnit: {
            protein_g: 24.2,
            carb_g: 7.9,
          },
        },
      },
      nutritionVersionReferences: [
        {
          id: 'ml_repoint',
          nutritionVersionId: '<current>',
          currentVersionId: '<current>',
          nutritionVersionOrigin: 'recorded',
        },
      ],
    })
  })

  it('clears the nutrition version when updateMealLog points to a food without nutrition', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_repoint_known',
      name: 'Known nutrition item',
      source: 'user_input',
      nutrients: { energy_kcal: 100 },
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_repoint_unknown',
      name: 'Unknown nutrition item',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_repoint_unknown',
      foodMasterId: 'fm_repoint_known',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 1,
    })

    const updated = (
      await repo.updateMealLog({
        id: 'ml_repoint_unknown',
        foodMasterId: 'fm_repoint_unknown',
      })
    )._unsafeUnwrap()

    expect(
      observation({
        row: normalizeRow(updated),
        nutritionVersionReferences: await readNutritionVersionReferences(tx, [
          'ml_repoint_unknown',
        ]),
      }),
    ).toEqual({
      row: {
        id: 'ml_repoint_unknown',
        foodMasterId: 'fm_repoint_unknown',
        eatenDate: '2026-06-15',
        mealType: 'lunch',
        quantity: 1,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      nutritionVersionReferences: [
        {
          id: 'ml_repoint_unknown',
          nutritionVersionId: null,
          currentVersionId: null,
          nutritionVersionOrigin: 'recorded',
        },
      ],
    })
  })

  it('updateMealLog returns a MealLogPersistenceError when the id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)

    const error = (
      await repo.updateMealLog({ id: 'ml_missing', quantity: 1 })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(MealLogPersistenceError)
  })

  it('deleteMealLog removes the row and returns true', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_delete',
      foodMasterId: 'fm_rice',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'breakfast',
      quantity: 150,
    })

    expect((await repo.deleteMealLog('ml_delete'))._unsafeUnwrap()).toBe(true)
    expect((await repo.findMealLogById('ml_delete'))._unsafeUnwrap()).toBeNull()
  })

  it('deleteMealLog returns false when the id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)

    expect((await repo.deleteMealLog('ml_missing'))._unsafeUnwrap()).toBe(false)
  })

  it('deleteMealLogs returns deleted entries in input order', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_batch_delete',
      name: '試験用食品',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx, {
      wrapDeleteManyInTransaction: false,
    })
    for (const [id, quantity] of [
      ['ml_batch_alpha', 1],
      ['ml_batch_beta', 2],
    ] as const) {
      await repo.insertMealLog({
        id,
        foodMasterId: 'fm_batch_delete',
        eatenDate: jstDate('2026-06-15'),
        mealType: 'lunch',
        quantity,
      })
    }

    const result = await repo.deleteMealLogs([
      'ml_batch_beta',
      'ml_batch_alpha',
    ])
    const remaining = await Promise.all([
      repo.findMealLogById('ml_batch_alpha'),
      repo.findMealLogById('ml_batch_beta'),
    ])

    expect(
      observation({
        deleted: result._unsafeUnwrap(),
        remaining: remaining.map((entry) => entry._unsafeUnwrap()),
      }),
    ).toEqual({
      deleted: [
        {
          id: 'ml_batch_beta',
          foodMasterId: 'fm_batch_delete',
          foodName: '試験用食品',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'lunch',
          quantity: 2,
        },
        {
          id: 'ml_batch_alpha',
          foodMasterId: 'fm_batch_delete',
          foodName: '試験用食品',
          eatenDate: jstDate('2026-06-15'),
          mealType: 'lunch',
          quantity: 1,
        },
      ],
      remaining: [null, null],
    })
  })

  it('deleteMealLogs leaves existing rows untouched when an ID is missing', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_batch_delete',
      name: '試験用食品',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx, {
      wrapDeleteManyInTransaction: false,
    })
    await repo.insertMealLog({
      id: 'ml_batch_alpha',
      foodMasterId: 'fm_batch_delete',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'lunch',
      quantity: 1,
    })

    const result = await repo.deleteMealLogs([
      'ml_batch_alpha',
      'ml_batch_missing',
    ])
    const remaining = await repo.findMealLogById('ml_batch_alpha')

    expect(
      observation({
        error: result.isErr() ? result.error : null,
        remaining: remaining._unsafeUnwrap()?.log.id ?? null,
      }),
    ).toEqual({
      error: new MealLogNotFoundError('ml_batch_missing'),
      remaining: 'ml_batch_alpha',
    })
  })
})
