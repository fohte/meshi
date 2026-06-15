import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'

import type { Sql } from '@/db'
import { foodMasterNutrients, foodMasters, mealLogs } from '@/db/schema'
import { FoodMasterNotFoundError } from '@/domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
} from '@/domain/meal-log/meal-log-repository'
import type { FoodMasterRef, MealLogRow } from '@/domain/meal-log/types'

type Db = ReturnType<typeof drizzle>

const loadFoodMaster = async (
  db: Db,
  foodMasterId: string,
): Promise<FoodMasterRef> => {
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
    throw new FoodMasterNotFoundError(foodMasterId)
  }

  const nutrientRows = await db
    .select({
      nutrientCode: foodMasterNutrients.nutrientCode,
      value: foodMasterNutrients.value,
    })
    .from(foodMasterNutrients)
    .where(eq(foodMasterNutrients.foodMasterId, foodMasterId))

  const nutrition: Record<string, number> = {}
  for (const row of nutrientRows) {
    nutrition[row.nutrientCode] = Number(row.value)
  }

  return {
    id: master.id,
    name: master.name,
    isEstimated: master.isEstimated,
    nutritionPer100g: nutrition,
  }
}

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

    async insertMealLog(input: InsertMealLogInput): Promise<MealLogRow> {
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
        throw new Error('meal_logs insert returned no rows')
      }
      return toRow(inserted)
    },

    async findMealLogById(id: string): Promise<FoundMealLog | null> {
      const rows = await db
        .select()
        .from(mealLogs)
        .where(eq(mealLogs.id, id))
        .limit(1)
      const row = rows[0]
      if (row === undefined) return null
      const food = await loadFoodMaster(db, row.foodMasterId)
      return { log: toRow(row), food }
    },
  }
}
