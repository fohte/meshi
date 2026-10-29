import { and, desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { ok, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { foodMasterNutrients, mealLogs } from '#db/schema'
import type {
  FoodDetail,
  FoodDetailService,
  FoodEatHistoryEntry,
} from '#domain/food-detail/types'
import { FoodDetailQueryError } from '#domain/food-detail/types'
import type { FoodMasterService } from '#domain/food-master/service'

type Db = ReturnType<typeof drizzle>

const loadHistory = async (
  db: Db,
  foodMasterId: string,
): Promise<ReadonlyArray<FoodEatHistoryEntry>> => {
  const rows = await db
    .select({
      id: mealLogs.id,
      eatenDate: mealLogs.eatenDate,
      mealType: mealLogs.mealType,
      quantity: mealLogs.quantity,
      energyKcalPerUnit: foodMasterNutrients.value,
    })
    .from(mealLogs)
    .leftJoin(
      foodMasterNutrients,
      and(
        eq(foodMasterNutrients.nutritionVersionId, mealLogs.nutritionVersionId),
        eq(foodMasterNutrients.nutrientCode, 'energy_kcal'),
      ),
    )
    .where(eq(mealLogs.foodMasterId, foodMasterId))
    .orderBy(desc(mealLogs.eatenDate), desc(mealLogs.createdAt))

  return rows.map((row) => ({
    id: row.id,
    eatenDate: row.eatenDate,
    mealType: row.mealType,
    quantity: Number(row.quantity),
    energyKcalPerUnit:
      row.energyKcalPerUnit === null ? null : Number(row.energyKcalPerUnit),
  }))
}

export const createFoodDetailService = (
  sql: Sql,
  foodMasterService: FoodMasterService,
): FoodDetailService => {
  const db: Db = drizzle(sql)

  return {
    getById: (id) =>
      foodMasterService.getById(id).andThen((master) => {
        if (master === null) return ok(null)

        return ResultAsync.fromPromise(
          loadHistory(db, id),
          (caughtErr) =>
            new FoodDetailQueryError(
              'failed to load meal_logs for food_master',
              caughtErr,
            ),
        ).map((history): FoodDetail => ({
          id: master.id,
          name: master.name,
          isEstimated: master.isEstimated,
          nutritionStatus: master.nutritionStatus,
          source: master.source,
          sourceUrl: master.sourceUrl,
          aliases: master.aliases,
          nutrition: master.nutrition,
          history,
          totalEatenCount: history.length,
        }))
      }),
  }
}
