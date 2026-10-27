import { eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import {
  err,
  errAsync,
  ok,
  okAsync,
  type Result,
  ResultAsync,
} from 'neverthrow'

import type { Sql } from '#db/index'
import { foodMasterNutrition, foodMasters, mealLogs } from '#db/schema'
import { defaultIdGenerator, type IdGenerator } from '#domain/food-master/id'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import {
  DomainError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import {
  loadFoodMaster,
  loadNutrition,
} from '#domain/meal-log/meal-log-food-loader'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
  MealLogWriteResult,
  UpdateMealLogPatch,
} from '#domain/meal-log/meal-log-repository'
import type {
  MealLogDeletionResult,
  MealLogRow,
  MealType,
} from '#domain/meal-log/types'
import {
  clearMealStockMovements,
  consumeStockForMealLog,
} from '#domain/stock/drizzle-meal-stock-sync'
import type { JstDate } from '#lib/jst-date'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

export interface DrizzleMealLogRepositoryOptions {
  readonly wrapDeleteManyInTransaction?: boolean
  readonly generateId?: IdGenerator
}

const toRow = (row: {
  id: string
  foodMasterId: string
  eatenDate: JstDate
  mealType: MealType
  quantity: string
  createdAt: Date
}): MealLogRow => ({
  id: row.id,
  foodMasterId: row.foodMasterId,
  eatenDate: row.eatenDate,
  mealType: row.mealType,
  quantity: Number(row.quantity),
  createdAt: row.createdAt,
})

export const createDrizzleMealLogRepository = (
  sql: Sql,
  options: DrizzleMealLogRepositoryOptions = {},
): MealLogRepository => {
  const db = drizzle(sql)
  const generateId = options.generateId ?? defaultIdGenerator
  const wrapDeleteManyInTransaction =
    options.wrapDeleteManyInTransaction ?? true

  const runInTransaction = <T>(
    operation: (session: Transaction) => Promise<Result<T, DomainError>>,
    failureMessage: string,
  ): ResultAsync<T, DomainError> =>
    ResultAsync.fromPromise(
      db.transaction(async (session) => {
        const result = await operation(session)
        if (result.isErr()) return Promise.reject(result.error)
        return result.value
      }),
      (caughtErr) =>
        caughtErr instanceof DomainError
          ? caughtErr
          : new MealLogPersistenceError(failureMessage, caughtErr),
    )

  const consumeMealStock = async (
    session: Transaction,
    input: {
      readonly mealLogId: string
      readonly foodMasterId: string
      readonly quantity: number
    },
  ): Promise<Result<number | null, DomainError>> => {
    const result = await consumeStockForMealLog(session, input, generateId)
    return result.mapErr(
      (error) =>
        new MealLogPersistenceError('failed to sync stock for meal_log', error),
    )
  }

  const withStockShortfall = (
    row: MealLogRow,
    stockShortfall: number | null,
  ): MealLogWriteResult => ({
    ...row,
    ...(stockShortfall === null ? {} : { stockShortfall }),
  })

  const deleteMealLogs = async (
    session: DbSession,
    ids: ReadonlyArray<string>,
  ): Promise<Result<ReadonlyArray<MealLogDeletionResult>, DomainError>> => {
    // Lock the rows so another delete cannot invalidate the all-or-none check.
    const rows = await session
      .select({
        id: mealLogs.id,
        foodMasterId: mealLogs.foodMasterId,
        foodName: foodMasters.name,
        eatenDate: mealLogs.eatenDate,
        mealType: mealLogs.mealType,
        quantity: mealLogs.quantity,
      })
      .from(mealLogs)
      .innerJoin(foodMasters, eq(mealLogs.foodMasterId, foodMasters.id))
      .where(inArray(mealLogs.id, ids))
      .for('update', { of: mealLogs })

    const foundIds = new Set(rows.map((row) => row.id))
    const missingId = ids.find((id) => !foundIds.has(id))
    if (missingId !== undefined) {
      return err(new MealLogNotFoundError(missingId))
    }

    const deletedRows = await session
      .delete(mealLogs)
      .where(inArray(mealLogs.id, ids))
      .returning({ id: mealLogs.id })
    if (deletedRows.length !== ids.length) {
      return err(
        new MealLogPersistenceError(
          'meal_logs bulk delete returned an unexpected number of rows',
        ),
      )
    }

    const positions = new Map(ids.map((id, index) => [id, index]))
    return ok(
      rows
        .toSorted(
          (left, right) =>
            (positions.get(left.id) ?? 0) - (positions.get(right.id) ?? 0),
        )
        .map((row) => ({
          id: row.id,
          foodMasterId: row.foodMasterId,
          foodName: row.foodName,
          eatenDate: row.eatenDate,
          mealType: row.mealType,
          quantity: Number(row.quantity),
        })),
    )
  }

  return {
    findFoodMaster: (id) => loadFoodMaster(db, id),

    insertMealLog: (
      input: InsertMealLogInput,
    ): ResultAsync<MealLogWriteResult, DomainError> =>
      runInTransaction(async (session) => {
        const [inserted] = await session
          .insert(mealLogs)
          .values({
            id: input.id,
            foodMasterId: input.foodMasterId,
            eatenDate: input.eatenDate,
            mealType: input.mealType,
            quantity: input.quantity.toString(),
          })
          .returning()
        if (inserted === undefined) {
          return err(
            new MealLogPersistenceError('meal_logs insert returned no rows'),
          )
        }
        const row = toRow(inserted)
        const stockResult = await consumeMealStock(session, {
          mealLogId: row.id,
          foodMasterId: row.foodMasterId,
          quantity: row.quantity,
        })
        return stockResult.map((shortfall) =>
          withStockShortfall(row, shortfall),
        )
      }, 'failed to insert meal_log'),

    insertMealLogs: (
      inputs: ReadonlyArray<InsertMealLogInput>,
    ): ResultAsync<ReadonlyArray<MealLogWriteResult>, DomainError> =>
      inputs.length === 0
        ? okAsync([])
        : runInTransaction(async (session) => {
            const inserted = await session
              .insert(mealLogs)
              .values(
                inputs.map((input) => ({
                  id: input.id,
                  foodMasterId: input.foodMasterId,
                  eatenDate: input.eatenDate,
                  mealType: input.mealType,
                  quantity: input.quantity.toString(),
                })),
              )
              .returning()
            if (inserted.length !== inputs.length) {
              return err(
                new MealLogPersistenceError(
                  'meal_logs bulk insert returned an unexpected number of rows',
                ),
              )
            }
            const rowsById = new Map(
              inserted.map((row) => [row.id, row] as const),
            )
            const writtenRows: MealLogWriteResult[] = []
            for (const input of inputs) {
              const insertedRow = rowsById.get(input.id)
              if (insertedRow === undefined) {
                return err(
                  new MealLogPersistenceError(
                    'meal_logs bulk insert returned incomplete rows',
                  ),
                )
              }
              const row = toRow(insertedRow)
              const stockResult = await consumeMealStock(session, {
                mealLogId: row.id,
                foodMasterId: row.foodMasterId,
                quantity: row.quantity,
              })
              if (stockResult.isErr()) return err(stockResult.error)
              writtenRows.push(withStockShortfall(row, stockResult.value))
            }
            return ok(writtenRows)
          }, 'failed to insert meal_logs'),

    updateMealLog: (
      input: UpdateMealLogPatch,
    ): ResultAsync<MealLogWriteResult, DomainError> =>
      runInTransaction(async (session) => {
        const [existing] = await session
          .select({
            foodMasterId: mealLogs.foodMasterId,
            quantity: mealLogs.quantity,
          })
          .from(mealLogs)
          .where(eq(mealLogs.id, input.id))
          .for('update')
        if (existing === undefined) {
          return err(
            new MealLogPersistenceError('meal_logs update returned no rows'),
          )
        }

        const foodMasterId = input.foodMasterId ?? existing.foodMasterId
        const quantity = input.quantity ?? Number(existing.quantity)
        const shouldSyncStock =
          foodMasterId !== existing.foodMasterId ||
          quantity !== Number(existing.quantity)
        if (shouldSyncStock) {
          await clearMealStockMovements(session, input.id)
        }

        const [updated] = await session
          .update(mealLogs)
          .set({
            ...(input.foodMasterId === undefined
              ? {}
              : { foodMasterId: input.foodMasterId }),
            ...(input.eatenDate === undefined
              ? {}
              : { eatenDate: input.eatenDate }),
            ...(input.mealType === undefined
              ? {}
              : { mealType: input.mealType }),
            ...(input.quantity === undefined
              ? {}
              : { quantity: input.quantity.toString() }),
          })
          .where(eq(mealLogs.id, input.id))
          .returning()
        if (updated === undefined) {
          return err(
            new MealLogPersistenceError('meal_logs update returned no rows'),
          )
        }
        const row = toRow(updated)
        if (!shouldSyncStock) return ok(withStockShortfall(row, null))

        const stockResult = await consumeMealStock(session, {
          mealLogId: row.id,
          foodMasterId: row.foodMasterId,
          quantity: row.quantity,
        })
        return stockResult.map((shortfall) =>
          withStockShortfall(row, shortfall),
        )
      }, 'failed to update meal_log'),

    deleteMealLog: (id: string): ResultAsync<boolean, DomainError> =>
      ResultAsync.fromPromise(
        db.delete(mealLogs).where(eq(mealLogs.id, id)).returning({
          id: mealLogs.id,
        }),
        (caughtErr) =>
          new MealLogPersistenceError('failed to delete meal_log', caughtErr),
      ).map((deleted) => deleted.length > 0),

    deleteMealLogs: (
      ids: ReadonlyArray<string>,
    ): ResultAsync<ReadonlyArray<MealLogDeletionResult>, DomainError> => {
      if (ids.length === 0) return okAsync([])
      if (new Set(ids).size !== ids.length) {
        return errAsync(
          new DomainError(
            'meal_log_ids must not contain duplicates',
            'meal_log/duplicate_ids',
          ),
        )
      }
      if (wrapDeleteManyInTransaction) {
        return runInTransaction(
          (tx) => deleteMealLogs(tx, ids),
          'failed to delete meal_logs',
        )
      }
      return ResultAsync.fromPromise(
        deleteMealLogs(db, ids),
        (caughtErr) =>
          new MealLogPersistenceError('failed to delete meal_logs', caughtErr),
      ).andThen((result) => result)
    },

    findMealLogById: (
      id: string,
    ): ResultAsync<FoundMealLog | null, DomainError> =>
      ResultAsync.fromPromise(
        (async (): Promise<FoundMealLog | null> => {
          const rows = await db
            .select({
              log: mealLogs,
              food: {
                id: foodMasters.id,
                name: foodMasters.name,
                isEstimated: foodMasterNutrition.isEstimated,
              },
            })
            .from(mealLogs)
            .innerJoin(foodMasters, eq(mealLogs.foodMasterId, foodMasters.id))
            .leftJoin(
              foodMasterNutrition,
              eq(foodMasterNutrition.foodMasterId, foodMasters.id),
            )
            .where(eq(mealLogs.id, id))
            .limit(1)
          // The FK on meal_logs.food_master_id is ON DELETE RESTRICT, so an existing
          // meal_log always has its food_master.
          const row = rows[0]
          if (row === undefined) return null

          const nutritionPerUnit = await loadNutrition(db, row.food.id)
          return {
            log: toRow(row.log),
            food: {
              ...row.food,
              isEstimated: row.food.isEstimated ?? false,
              nutritionStatus: nutritionStatusFromIsEstimated(
                row.food.isEstimated,
              ),
              nutritionPerUnit,
            },
          }
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to load meal_log', caughtErr),
      ),
  }
}
