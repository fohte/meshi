import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, type Result, ResultAsync } from 'neverthrow'

import {
  foodMasterNutrients,
  foodMasterNutrition,
  foodMasters,
} from '#db/schema'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import {
  DomainError,
  FoodMasterNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { FoodMasterRef } from '#domain/meal-log/types'

type Db = ReturnType<typeof drizzle>

export const loadNutrition = async (
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

export const loadFoodMaster = (
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
        nutritionStatus: nutritionStatusFromIsEstimated(master.isEstimated),
        nutritionPerUnit,
      })
    })(),
    (caughtErr) =>
      new MealLogPersistenceError('failed to load food_master', caughtErr),
  ).andThen((result) => result)
