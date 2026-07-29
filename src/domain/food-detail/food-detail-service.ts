import { desc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { ok, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { mealLogs } from '#db/schema'
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
    .select()
    .from(mealLogs)
    .where(eq(mealLogs.foodMasterId, foodMasterId))
    .orderBy(desc(mealLogs.eatenAt))

  return rows.map((row) => ({
    id: row.id,
    eatenAt: row.eatenAt,
    mealType: row.mealType,
    amountGrams: Number(row.amountGrams),
    quantity: Number(row.quantity),
    unit: row.unit,
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
          source: master.source,
          sourceUrl: master.sourceUrl,
          aliases: master.aliases,
          nutritionPer100g: master.nutrition,
          history,
          totalEatenCount: history.length,
        }))
      }),
  }
}
