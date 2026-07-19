import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'

import type { Sql } from '@/db'
import { foodMasterNutrients, foodMasters, mealLogs } from '@/db/schema'
import type { DomainError } from '@/domain/meal-log/errors'
import {
  FoodMasterNotFoundError,
  MealLogPersistenceError,
} from '@/domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
} from '@/domain/meal-log/meal-log-repository'
import type { FoodMasterRef, MealLogRow } from '@/domain/meal-log/types'

type Db = ReturnType<typeof drizzle>

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
          isEstimated: foodMasters.isEstimated,
        })
        .from(foodMasters)
        .where(eq(foodMasters.id, foodMasterId))
        .limit(1)

      const master = masterRows[0]
      if (master === undefined) {
        return err(new FoodMasterNotFoundError(foodMasterId))
      }

      return ok({
        id: master.id,
        name: master.name,
        isEstimated: master.isEstimated,
        nutritionPer100g: await loadNutrition(db, foodMasterId),
      })
    })(),
    (caughtErr) =>
      new MealLogPersistenceError('failed to load food_master', caughtErr),
  ).andThen((result) => result)

const toRow = (row: {
  id: string
  foodMasterId: string
  eatenAt: Date
  quantity: string
  unit: string
  note: string | null
  createdAt: Date
}): MealLogRow => ({
  id: row.id,
  foodMasterId: row.foodMasterId,
  eatenAt: row.eatenAt,
  quantity: Number(row.quantity),
  unit: row.unit,
  note: row.note,
  createdAt: row.createdAt,
})

export const createDrizzleMealLogRepository = (sql: Sql): MealLogRepository => {
  const db = drizzle(sql)

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
              eatenAt: input.eatenAt,
              quantity: input.quantity.toString(),
              unit: input.unit,
              note: input.note,
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
                isEstimated: foodMasters.isEstimated,
              },
            })
            .from(mealLogs)
            .innerJoin(foodMasters, eq(mealLogs.foodMasterId, foodMasters.id))
            .where(eq(mealLogs.id, id))
            .limit(1)
          // The FK on meal_logs.food_master_id is ON DELETE RESTRICT, so an existing
          // meal_log always has its food_master. An empty innerJoin therefore means
          // the meal_log itself does not exist, not that the food_master is missing.
          const row = rows[0]
          if (row === undefined) return null

          return {
            log: toRow(row.log),
            food: {
              ...row.food,
              nutritionPer100g: await loadNutrition(db, row.food.id),
            },
          }
        })(),
        (caughtErr) =>
          new MealLogPersistenceError('failed to load meal_log', caughtErr),
      ),
  }
}
