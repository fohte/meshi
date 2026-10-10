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
import {
  foodMasterNutrients,
  foodMasterNutrition,
  foodMasters,
  mealLogs,
} from '#db/schema'
import {
  DomainError,
  FoodMasterNotFoundError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
  UpdateMealLogPatch,
} from '#domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogDeletionResult,
  MealLogRow,
  MealType,
} from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

export interface DrizzleMealLogRepositoryOptions {
  readonly wrapDeleteManyInTransaction?: boolean
}

const loadNutrition = async (
  db: Db,
  foodMasterId: string,
): Promise<Record<string, number>> => {
  const rows = await db
    .select({
      nutrientCode: foodMasterNutrients.nutrientCode,
      value: foodMasterNutrients.value,
    })
    .from(foodMasterNutrients)
    .where(eq(foodMasterNutrients.foodMasterId, foodMasterId))

  const nutrition: Record<string, number> = {}
  for (const row of rows) {
    nutrition[row.nutrientCode] = Number(row.value)
  }
  return nutrition
}

const loadFoodMaster = (
  db: Db,
  foodMasterId: string,
): ResultAsync<FoodMasterRef, DomainError> =>
  ResultAsync.fromPromise(
    (async (): Promise<Result<FoodMasterRef, DomainError>> => {
      const masterRows = await db
        .select({
          id: foodMasters.id,
          name: foodMasters.name,
          isEstimated: foodMasterNutrition.isEstimated,
        })
        .from(foodMasters)
        .leftJoin(
          foodMasterNutrition,
          eq(foodMasterNutrition.foodMasterId, foodMasters.id),
        )
        .where(eq(foodMasters.id, foodMasterId))
        .limit(1)

      const master = masterRows[0]
      if (master === undefined) {
        return err(new FoodMasterNotFoundError(foodMasterId))
      }

      const nutritionPerUnit = await loadNutrition(db, foodMasterId)
      return ok({
        id: master.id,
        name: master.name,
        isEstimated: master.isEstimated ?? false,
        nutritionStatus:
          master.isEstimated === null
            ? 'unknown'
            : master.isEstimated
              ? 'estimated'
              : 'confirmed',
        nutritionPerUnit,
      })
    })(),
    (caughtErr) =>
      new MealLogPersistenceError('failed to load food_master', caughtErr),
  ).andThen((result) => result)

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
  const wrapDeleteManyInTransaction =
    options.wrapDeleteManyInTransaction ?? true

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
    ): ResultAsync<MealLogRow, DomainError> =>
      ResultAsync.fromPromise(
        (async (): Promise<Result<MealLogRow, DomainError>> => {
          const [inserted] = await db
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
          return ok(toRow(inserted))
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to insert meal_log', caughtErr),
      ).andThen((result) => result),

    insertMealLogs: (
      inputs: ReadonlyArray<InsertMealLogInput>,
    ): ResultAsync<ReadonlyArray<MealLogRow>, DomainError> =>
      ResultAsync.fromPromise(
        (async (): Promise<Result<ReadonlyArray<MealLogRow>, DomainError>> => {
          if (inputs.length === 0) return ok([])
          const inserted = await db
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
          return ok(inserted.map(toRow))
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to insert meal_logs', caughtErr),
      ).andThen((result) => result),

    updateMealLog: (
      input: UpdateMealLogPatch,
    ): ResultAsync<MealLogRow, DomainError> =>
      ResultAsync.fromPromise(
        (async (): Promise<Result<MealLogRow, DomainError>> => {
          const [updated] = await db
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
          return ok(toRow(updated))
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to update meal_log', caughtErr),
      ).andThen((result) => result),

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
      const operation = wrapDeleteManyInTransaction
        ? db.transaction((tx) => deleteMealLogs(tx, ids))
        : deleteMealLogs(db, ids)
      return ResultAsync.fromPromise(
        operation,
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
              nutritionStatus:
                row.food.isEstimated === null
                  ? 'unknown'
                  : row.food.isEstimated
                    ? 'estimated'
                    : 'confirmed',
              nutritionPerUnit,
            },
          }
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to load meal_log', caughtErr),
      ),
  }
}
