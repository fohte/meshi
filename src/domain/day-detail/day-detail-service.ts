import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { okAsync, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { foodMasterNutrients, foodMasters } from '#db/schema'
import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type {
  DayDetail,
  DayDetailEntry,
  DayDetailService,
} from '#domain/day-detail/types'
import { DayDetailQueryError } from '#domain/day-detail/types'
import type {
  MealHistoryAggregate,
  MealHistoryService,
} from '#domain/meal-history/types'

const ENERGY_KCAL_CODE = 'energy_kcal'
const PER_100G_BASE = 100

type Db = ReturnType<typeof drizzle>

// Composes on MealHistoryService for the day-boundary aggregation and adds
// one batched food_masters lookup for the fields the day view needs per item
// — food name and per-item kcal — so rendering the timeline never issues a
// query per entry.
export const createDayDetailService = (
  sql: Sql,
  mealHistoryService: MealHistoryService,
): DayDetailService => {
  const db = drizzle(sql)

  return {
    query(input) {
      return mealHistoryService
        .query({
          periodFrom: input.periodFrom,
          periodTo: input.periodTo,
          nutrientCodes: NUTRIENT_CODES,
        })
        .mapErr(
          (queryError) =>
            new DayDetailQueryError('meal history query failed', queryError),
        )
        .andThen((aggregate) => enrichEntries(db, aggregate))
    },
  }
}

const enrichEntries = (
  db: Db,
  aggregate: MealHistoryAggregate,
): ResultAsync<DayDetail, DayDetailQueryError> => {
  const foodMasterIds = [
    ...new Set(aggregate.entries.map((entry) => entry.foodMasterId)),
  ]

  if (foodMasterIds.length === 0) {
    return okAsync({
      totals: aggregate.totals,
      hasEstimatedValues: aggregate.hasEstimatedValues,
      entries: [],
    })
  }

  return ResultAsync.fromPromise(
    db
      .select({
        id: foodMasters.id,
        name: foodMasters.name,
        isEstimated: foodMasters.isEstimated,
        kcalPer100: foodMasterNutrients.value,
      })
      .from(foodMasters)
      .leftJoin(
        foodMasterNutrients,
        and(
          eq(foodMasterNutrients.foodMasterId, foodMasters.id),
          eq(foodMasterNutrients.nutrientCode, ENERGY_KCAL_CODE),
        ),
      )
      .where(inArray(foodMasters.id, foodMasterIds)),
    (caughtErr) =>
      new DayDetailQueryError('food master lookup failed', caughtErr),
  ).map((rows) => {
    const byId = new Map(
      rows.map((row) => [
        row.id,
        {
          name: row.name,
          isEstimated: row.isEstimated,
          kcalPer100: row.kcalPer100 === null ? 0 : Number(row.kcalPer100),
        },
      ]),
    )

    const entries: DayDetailEntry[] = aggregate.entries.map((entry) => {
      const food = byId.get(entry.foodMasterId)
      return {
        id: entry.id,
        foodMasterId: entry.foodMasterId,
        foodName: food?.name ?? entry.foodMasterId,
        eatenAt: entry.eatenAt,
        mealType: entry.mealType,
        quantity: entry.quantity,
        unit: entry.unit,
        note: entry.note,
        kcal: ((food?.kcalPer100 ?? 0) * entry.quantity) / PER_100G_BASE,
        isEstimated: food?.isEstimated ?? false,
      }
    })

    return {
      totals: aggregate.totals,
      hasEstimatedValues: aggregate.hasEstimatedValues,
      entries,
    }
  })
}
