import { and, asc, eq, inArray } from 'drizzle-orm'
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
import {
  loadFoundMealLogs,
  toRow,
} from '#domain/meal-log/drizzle-meal-log-reader'
import {
  DomainError,
  FoodMasterNotFoundError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import { loadFoodMaster } from '#domain/meal-log/meal-log-food-loader'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
  MealLogWriteResult,
  UpdateMealLogPatch,
} from '#domain/meal-log/meal-log-repository'
import type { MealLogDeletionResult } from '#domain/meal-log/types'
import {
  clearMealStockMovements,
  consumeStockForMealLog,
} from '#domain/stock/drizzle-meal-stock-sync'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

const loadCurrentNutritionVersionIds = async (
  session: DbSession,
  foodMasterIds: ReadonlyArray<string>,
): Promise<Result<ReadonlyMap<string, string | null>, DomainError>> => {
  const ids = [...new Set(foodMasterIds)].toSorted()
  if (ids.length === 0) return ok(new Map())

  const foodRows = await session
    .select({
      foodMasterId: foodMasters.id,
    })
    .from(foodMasters)
    .where(inArray(foodMasters.id, ids))
    .orderBy(asc(foodMasters.id))
    .for('key share', { of: foodMasters })

  const foundFoodMasterIds = new Set(foodRows.map((row) => row.foodMasterId))
  const missingId = ids.find((id) => !foundFoodMasterIds.has(id))
  if (missingId !== undefined) {
    return err(new FoodMasterNotFoundError(missingId))
  }

  const versionRows = await session
    .select({
      foodMasterId: foodMasterNutrition.foodMasterId,
      nutritionVersionId: foodMasterNutrition.id,
    })
    .from(foodMasterNutrition)
    .where(
      and(
        inArray(foodMasterNutrition.foodMasterId, ids),
        eq(foodMasterNutrition.isCurrent, true),
      ),
    )
    .orderBy(asc(foodMasterNutrition.foodMasterId))
    .for('share')
  const currentVersions = new Map(
    versionRows.map((row) => [row.foodMasterId, row.nutritionVersionId]),
  )
  return ok(
    new Map(ids.map((id) => [id, currentVersions.get(id) ?? null] as const)),
  )
}

export interface DrizzleMealLogRepositoryOptions {
  readonly wrapDeleteManyInTransaction?: boolean
  readonly generateId?: IdGenerator
}

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
    found: FoundMealLog,
    stockShortfall: number | null,
  ): MealLogWriteResult => ({
    ...found,
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
        const currentVersions = await loadCurrentNutritionVersionIds(session, [
          input.foodMasterId,
        ])
        if (currentVersions.isErr()) return err(currentVersions.error)

        const [inserted] = await session
          .insert(mealLogs)
          .values({
            id: input.id,
            foodMasterId: input.foodMasterId,
            nutritionVersionId:
              currentVersions.value.get(input.foodMasterId) ?? null,
            nutritionVersionOrigin: 'recorded',
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
        if (stockResult.isErr()) return err(stockResult.error)
        const found = (await loadFoundMealLogs(session, [row.id])).get(row.id)
        if (found === undefined) {
          return err(
            new MealLogPersistenceError(
              'meal_logs insert returned no row when loading its nutrition version',
            ),
          )
        }
        return ok(withStockShortfall(found, stockResult.value))
      }, 'failed to insert meal_log'),

    insertMealLogs: (
      inputs: ReadonlyArray<InsertMealLogInput>,
    ): ResultAsync<ReadonlyArray<MealLogWriteResult>, DomainError> =>
      inputs.length === 0
        ? okAsync([])
        : runInTransaction(async (session) => {
            const currentVersions = await loadCurrentNutritionVersionIds(
              session,
              inputs.map((input) => input.foodMasterId),
            )
            if (currentVersions.isErr()) return err(currentVersions.error)

            const inserted = await session
              .insert(mealLogs)
              .values(
                inputs.map((input) => ({
                  id: input.id,
                  foodMasterId: input.foodMasterId,
                  nutritionVersionId:
                    currentVersions.value.get(input.foodMasterId) ?? null,
                  nutritionVersionOrigin: 'recorded',
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
            const stockShortfalls = new Map<string, number | null>()
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
              stockShortfalls.set(input.id, stockResult.value)
            }
            const foundById = await loadFoundMealLogs(
              session,
              inputs.map((input) => input.id),
            )
            const writtenRows: MealLogWriteResult[] = []
            for (const input of inputs) {
              const found = foundById.get(input.id)
              const stockShortfall = stockShortfalls.get(input.id)
              if (found === undefined || stockShortfall === undefined) {
                return err(
                  new MealLogPersistenceError(
                    'meal_logs bulk insert returned incomplete stored nutrition rows',
                  ),
                )
              }
              writtenRows.push(withStockShortfall(found, stockShortfall))
            }
            return ok(writtenRows)
          }, 'failed to insert meal_logs'),

    updateMealLog: (
      input: UpdateMealLogPatch,
    ): ResultAsync<MealLogWriteResult, DomainError> =>
      runInTransaction(async (session) => {
        const existingRows = await session
          .select({ foodMasterId: mealLogs.foodMasterId })
          .from(mealLogs)
          .where(eq(mealLogs.id, input.id))
          .limit(1)
        const initialFoodMasterId = existingRows[0]?.foodMasterId
        if (initialFoodMasterId === undefined) {
          return err(
            new MealLogPersistenceError('meal_logs update returned no rows'),
          )
        }

        let currentVersions: ReadonlyMap<string, string | null> | undefined
        if (input.foodMasterId !== undefined) {
          const loadedVersions = await loadCurrentNutritionVersionIds(session, [
            initialFoodMasterId,
            input.foodMasterId,
          ])
          if (loadedVersions.isErr()) return err(loadedVersions.error)
          currentVersions = loadedVersions.value
        }

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
        const foodMasterChanged =
          input.foodMasterId !== undefined &&
          input.foodMasterId !== existing.foodMasterId
        const quantity = input.quantity ?? Number(existing.quantity)
        const shouldSyncStock =
          foodMasterChanged || quantity !== Number(existing.quantity)
        if (shouldSyncStock) {
          await clearMealStockMovements(session, input.id)
        }

        const [updated] = await session
          .update(mealLogs)
          .set({
            ...(input.foodMasterId === undefined
              ? {}
              : { foodMasterId: input.foodMasterId }),
            ...(foodMasterChanged
              ? {
                  nutritionVersionId:
                    currentVersions?.get(foodMasterId) ?? null,
                  nutritionVersionOrigin: 'recorded',
                }
              : {}),
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
        let stockShortfall: number | null = null
        if (shouldSyncStock) {
          const stockResult = await consumeMealStock(session, {
            mealLogId: row.id,
            foodMasterId: row.foodMasterId,
            quantity: row.quantity,
          })
          if (stockResult.isErr()) return err(stockResult.error)
          stockShortfall = stockResult.value
        }
        const found = (await loadFoundMealLogs(session, [row.id])).get(row.id)
        if (found === undefined) {
          return err(
            new MealLogPersistenceError(
              'meal_logs update returned no row when loading its nutrition version',
            ),
          )
        }
        return ok(withStockShortfall(found, stockShortfall))
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
        loadFoundMealLogs(db, [id]).then(
          (foundById) => foundById.get(id) ?? null,
        ),
        (caughtErr) =>
          new MealLogPersistenceError('failed to load meal_log', caughtErr),
      ),
  }
}
