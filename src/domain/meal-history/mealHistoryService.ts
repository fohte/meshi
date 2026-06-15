import { and, asc, eq, gte, inArray, lt, type SQL, sql } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'

import {
  foodMasterNutrients,
  foodMasters,
  mealLogs,
  nutrientDefinitions,
} from '@/db/schema'
import type {
  MealHistoryAggregate,
  MealHistoryDayTotals,
  MealHistoryService,
  MealLogEntry,
  NutrientCode,
  NutritionMap,
  QueryMealHistoryInput,
} from '@/domain/meal-history/types'

export type MealHistoryDb = PgDatabase<PgQueryResultHKT>

const PER_100G_BASE = 100

export const createMealHistoryService = (
  db: MealHistoryDb,
): MealHistoryService => ({
  async query(input: QueryMealHistoryInput): Promise<MealHistoryAggregate> {
    const periodWhere: SQL[] = [
      gte(mealLogs.eatenAt, input.periodFrom),
      lt(mealLogs.eatenAt, input.periodTo),
    ]
    if (input.foodFilter !== undefined && input.foodFilter.length > 0) {
      periodWhere.push(inArray(mealLogs.foodMasterId, [...input.foodFilter]))
    }

    const nutrientWhere: SQL =
      input.nutrientCodes === undefined
        ? sql`${foodMasterNutrients.nutrientCode} IN (SELECT ${nutrientDefinitions.code} FROM ${nutrientDefinitions} WHERE ${nutrientDefinitions.isMajor} = true)`
        : inArray(foodMasterNutrients.nutrientCode, [...input.nutrientCodes])

    const dayExpr =
      sql<string>`to_char(date_trunc('day', ${mealLogs.eatenAt} AT TIME ZONE 'UTC'), 'YYYY-MM-DD')`.as(
        'day',
      )
    const sumExpr =
      sql<string>`SUM(${foodMasterNutrients.value} * ${mealLogs.quantity} / ${PER_100G_BASE})`.as(
        'sum_value',
      )

    const { aggregateRows, entryRows } = await db.transaction(
      async (tx) => {
        const aggregate = await tx
          .select({
            day: dayExpr,
            nutrientCode: foodMasterNutrients.nutrientCode,
            value: sumExpr,
          })
          .from(mealLogs)
          .innerJoin(
            foodMasterNutrients,
            eq(foodMasterNutrients.foodMasterId, mealLogs.foodMasterId),
          )
          .where(and(...periodWhere, nutrientWhere))
          .groupBy(dayExpr, foodMasterNutrients.nutrientCode)
          .orderBy(dayExpr, foodMasterNutrients.nutrientCode)
        const entries = await tx
          .select({
            id: mealLogs.id,
            foodMasterId: mealLogs.foodMasterId,
            eatenAt: mealLogs.eatenAt,
            quantity: mealLogs.quantity,
            unit: mealLogs.unit,
            note: mealLogs.note,
            isEstimated: foodMasters.isEstimated,
          })
          .from(mealLogs)
          .innerJoin(foodMasters, eq(foodMasters.id, mealLogs.foodMasterId))
          .where(and(...periodWhere))
          .orderBy(asc(mealLogs.eatenAt), asc(mealLogs.id))
        return { aggregateRows: aggregate, entryRows: entries }
      },
      { isolationLevel: 'repeatable read', accessMode: 'read only' },
    )

    const perDay = buildPerDay(aggregateRows)
    const totals = sumPerDay(perDay)
    const entries: MealLogEntry[] = entryRows.map((row) => ({
      id: row.id,
      foodMasterId: row.foodMasterId,
      eatenAt: row.eatenAt,
      quantity: Number(row.quantity),
      unit: row.unit,
      note: row.note,
    }))
    const hasEstimatedValues = entryRows.some((row) => row.isEstimated)

    return { totals, perDay, entries, hasEstimatedValues }
  },
})

const buildPerDay = (
  rows: ReadonlyArray<{
    day: string
    nutrientCode: NutrientCode
    value: string
  }>,
): ReadonlyArray<MealHistoryDayTotals> => {
  const byDay = new Map<string, Record<NutrientCode, number>>()
  for (const row of rows) {
    const day = byDay.get(row.day) ?? {}
    day[row.nutrientCode] = Number(row.value)
    byDay.set(row.day, day)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, totals]) => ({ date, totals }))
}

const sumPerDay = (
  perDay: ReadonlyArray<MealHistoryDayTotals>,
): NutritionMap => {
  const totals: Record<NutrientCode, number> = {}
  for (const { totals: dayTotals } of perDay) {
    for (const [code, value] of Object.entries(dayTotals)) {
      totals[code] = (totals[code] ?? 0) + value
    }
  }
  return totals
}
