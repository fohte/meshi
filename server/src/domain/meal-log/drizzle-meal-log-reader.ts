import { and, asc, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'

import {
  foodMasterNutrients,
  foodMasterNutrition,
  foodMasters,
  mealLogs,
} from '#db/schema'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import type { FoundMealLog } from '#domain/meal-log/meal-log-repository'
import type {
  FoodMasterRef,
  MealLogRow,
  MealType,
} from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

type Db = ReturnType<typeof drizzle>
type Transaction = Parameters<Parameters<Db['transaction']>[0]>[0]
type DbSession = Db | Transaction

export const toRow = (row: {
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

type MutableFoodMasterRef = Omit<FoodMasterRef, 'nutritionPerUnit'> & {
  nutritionPerUnit: Record<string, number>
}

export const loadFoundMealLogs = async (
  session: DbSession,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyMap<string, FoundMealLog>> => {
  if (ids.length === 0) return new Map()

  const rows = await session
    .select({
      log: mealLogs,
      food: {
        id: foodMasters.id,
        name: foodMasters.name,
        isEstimated: foodMasterNutrition.isEstimated,
      },
      nutrientCode: foodMasterNutrients.nutrientCode,
      nutrientValue: foodMasterNutrients.value,
    })
    .from(mealLogs)
    .innerJoin(foodMasters, eq(mealLogs.foodMasterId, foodMasters.id))
    .leftJoin(
      foodMasterNutrition,
      and(
        eq(foodMasterNutrition.id, mealLogs.nutritionVersionId),
        eq(foodMasterNutrition.foodMasterId, mealLogs.foodMasterId),
      ),
    )
    .leftJoin(
      foodMasterNutrients,
      eq(foodMasterNutrients.nutritionVersionId, mealLogs.nutritionVersionId),
    )
    .where(inArray(mealLogs.id, ids))
    .orderBy(asc(mealLogs.id), asc(foodMasterNutrients.nutrientCode))

  const mutable = new Map<
    string,
    { readonly log: MealLogRow; readonly food: MutableFoodMasterRef }
  >()
  for (const row of rows) {
    let found = mutable.get(row.log.id)
    if (found === undefined) {
      found = {
        log: toRow(row.log),
        food: {
          ...row.food,
          isEstimated: row.food.isEstimated ?? false,
          nutritionStatus: nutritionStatusFromIsEstimated(row.food.isEstimated),
          nutritionPerUnit: {},
        },
      }
      mutable.set(row.log.id, found)
    }
    if (row.nutrientCode !== null && row.nutrientValue !== null) {
      found.food.nutritionPerUnit[row.nutrientCode] = Number(row.nutrientValue)
    }
  }

  return new Map(
    [...mutable].map(([id, found]) => [
      id,
      {
        log: found.log,
        food: {
          ...found.food,
          nutritionPerUnit: found.food.nutritionPerUnit,
        },
      },
    ]),
  )
}
