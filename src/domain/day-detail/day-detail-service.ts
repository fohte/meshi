import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { okAsync, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { foodMasterNutrients, foodMasters, mealLogs } from '#db/schema'
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
import { MEAL_TYPES } from '#domain/meal-log/types'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { nextJstDateString } from '#lib/jst-date'

const ENERGY_KCAL_CODE = 'energy_kcal'

type Db = ReturnType<typeof drizzle>

// Composes on MealHistoryService for the day-boundary aggregation and adds
// two batched lookups for the fields the day view needs per item — food
// name/estimated flag, and each entry's resolved amount_grams (the same
// basis MealHistoryService's own totals use, not quantity/unit — see
// resolveAmountGrams) — so rendering the timeline never issues a query per
// entry.
//
// These two lookups run outside MealHistoryService's own query, so a
// concurrent correction landing between them could in principle make a
// day's totals and its entries' kcal disagree by one page load. Accepted:
// meshi is single-user, the window is one HTTP request wide, and the next
// load is self-correcting.
export const createDayDetailService = (
  sql: Sql,
  mealHistoryService: MealHistoryService,
  mealSkipService: MealSkipService,
): DayDetailService => {
  const db = drizzle(sql)

  return {
    query(input) {
      const historyResult = mealHistoryService
        .query({
          periodFrom: input.date,
          periodTo: nextJstDateString(input.date),
          nutrientCodes: NUTRIENT_CODES,
        })
        .mapErr(
          (queryError) =>
            new DayDetailQueryError('meal history query failed', queryError),
        )
      const skipsResult = mealSkipService
        .findForDate(input.date)
        .mapErr(
          (queryError) =>
            new DayDetailQueryError('meal skip query failed', queryError),
        )

      return ResultAsync.combine([historyResult, skipsResult]).andThen(
        ([aggregate, skips]) => enrichEntries(db, aggregate, skips),
      )
    },
  }
}

const enrichEntries = (
  db: Db,
  aggregate: MealHistoryAggregate,
  skips: ReadonlyArray<MealSkipRow>,
): ResultAsync<DayDetail, DayDetailQueryError> => {
  const entryIds = aggregate.entries.map((entry) => entry.id)
  const foodMasterIds = [
    ...new Set(aggregate.entries.map((entry) => entry.foodMasterId)),
  ]

  const eatenMealTypes = new Set(
    aggregate.entries.map((entry) => entry.mealType),
  )
  const skippedSet = new Set(
    skips
      .map((skip) => skip.mealType)
      .filter((mealType) => !eatenMealTypes.has(mealType)),
  )
  const skippedMealTypes = MEAL_TYPES.filter((mealType) =>
    skippedSet.has(mealType),
  )

  if (foodMasterIds.length === 0) {
    return okAsync({
      totals: aggregate.totals,
      hasEstimatedValues: aggregate.hasEstimatedValues,
      entries: [],
      skippedMealTypes,
    })
  }

  return ResultAsync.fromPromise(
    Promise.all([
      db
        .select({
          id: foodMasters.id,
          name: foodMasters.name,
          isEstimated: foodMasters.isEstimated,
          kcalPerBasis: foodMasterNutrients.value,
          basisQuantity: foodMasters.basisQuantity,
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
      db
        .select({ id: mealLogs.id, amountGrams: mealLogs.amountGrams })
        .from(mealLogs)
        .where(inArray(mealLogs.id, entryIds)),
    ]),
    (caughtErr) =>
      new DayDetailQueryError('day detail enrichment lookup failed', caughtErr),
  ).map(([foodRows, mealLogRows]) => {
    const foodById = new Map(
      foodRows.map((row) => [
        row.id,
        {
          name: row.name,
          isEstimated: row.isEstimated,
          kcalPerBasis:
            row.kcalPerBasis === null ? 0 : Number(row.kcalPerBasis),
          basisQuantity: Number(row.basisQuantity),
        },
      ]),
    )
    const amountGramsById = new Map(
      mealLogRows.map((row) => [row.id, Number(row.amountGrams)]),
    )

    const entries: DayDetailEntry[] = aggregate.entries.map((entry) => {
      const food = foodById.get(entry.foodMasterId)
      const amountGrams = amountGramsById.get(entry.id) ?? 0
      return {
        id: entry.id,
        foodMasterId: entry.foodMasterId,
        foodName: food?.name ?? entry.foodMasterId,
        eatenDate: entry.eatenDate,
        mealType: entry.mealType,
        quantity: entry.quantity,
        unit: entry.unit,
        kcal:
          ((food?.kcalPerBasis ?? 0) * amountGrams) /
          (food?.basisQuantity ?? 100),
        isEstimated: food?.isEstimated ?? false,
      }
    })

    return {
      totals: aggregate.totals,
      hasEstimatedValues: aggregate.hasEstimatedValues,
      entries,
      skippedMealTypes,
    }
  })
}
