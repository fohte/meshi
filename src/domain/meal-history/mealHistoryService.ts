import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { createAsText, type Sql } from '#db/index'
import type {
  MealHistoryDayTotals,
  MealHistoryService,
  MealLogEntry,
  NutrientCode,
  NutritionMap,
} from '#domain/meal-history/types'
import { MealHistoryQueryError } from '#domain/meal-history/types'
import { MEAL_TYPES } from '#domain/meal-log/types'

const numericString = z.union([
  z.number().refine(Number.isFinite),
  z.string().transform((s, ctx) => {
    const n = Number(s)
    if (!Number.isFinite(n)) {
      ctx.addIssue({ code: 'custom', message: `not a finite number: ${s}` })
      return z.NEVER
    }
    return n
  }),
])

const aggregateRowSchema = z.object({
  day: z.string(),
  nutrient_code: z.string(),
  value: numericString,
})

const entryRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  eaten_date: z.string(),
  meal_type: z.enum(MEAL_TYPES),
  quantity: numericString,
  unit: z.string(),
  is_estimated: z.boolean(),
})

export const createMealHistoryService = (sql: Sql): MealHistoryService => {
  const asText = createAsText(sql)

  return {
    query(input) {
      const foodFilter =
        input.foodFilter !== undefined && input.foodFilter.length > 0
          ? input.foodFilter
          : null
      const nutrientCodes = input.nutrientCodes
      const useMajorOnly = nutrientCodes === undefined
      const emptyNutrientFilter =
        nutrientCodes !== undefined && nutrientCodes.length === 0
      // Bound as explicit text + inline `::date` cast so the query survives
      // a pool whose date serializer was flipped to identity pass-through
      // by a `drizzle()` instance built on the same connection (see the
      // comment in src/a2a/postgres-task-store.ts).
      const periodFrom = asText(input.periodFrom)
      const periodTo = asText(input.periodTo)

      return ResultAsync.fromPromise(
        (async () => {
          const aggregateRaw = emptyNutrientFilter
            ? []
            : await sql`
                SELECT
                  to_char(ml.eaten_date, 'YYYY-MM-DD') AS day,
                  fmn.nutrient_code AS nutrient_code,
                  SUM(fmn.value * ml.amount_grams / fm.basis_quantity) AS value
                FROM meal_logs ml
                INNER JOIN food_master_nutrients fmn
                  ON fmn.food_master_id = ml.food_master_id
                INNER JOIN food_masters fm
                  ON fm.id = ml.food_master_id
                WHERE ml.eaten_date >= ${periodFrom}::date
                  AND ml.eaten_date < ${periodTo}::date
                  AND (
                    ${foodFilter === null}::boolean
                    OR ml.food_master_id = ANY(${foodFilter ?? []}::text[])
                  )
                  AND (
                    CASE
                      WHEN ${useMajorOnly}::boolean THEN fmn.nutrient_code IN (
                        SELECT code FROM nutrient_definitions WHERE is_major = true
                      )
                      ELSE fmn.nutrient_code = ANY(${nutrientCodes ?? []}::text[])
                    END
                  )
                GROUP BY day, fmn.nutrient_code
                ORDER BY day, fmn.nutrient_code
              `

          const entryRaw = await sql`
            SELECT
              ml.id AS id,
              ml.food_master_id AS food_master_id,
              fm.name AS food_name,
              to_char(ml.eaten_date, 'YYYY-MM-DD') AS eaten_date,
              ml.meal_type AS meal_type,
              ml.quantity AS quantity,
              ml.unit AS unit,
              fm.is_estimated AS is_estimated
            FROM meal_logs ml
            INNER JOIN food_masters fm ON fm.id = ml.food_master_id
            WHERE ml.eaten_date >= ${periodFrom}::date
              AND ml.eaten_date < ${periodTo}::date
              AND (
                ${foodFilter === null}::boolean
                OR ml.food_master_id = ANY(${foodFilter ?? []}::text[])
              )
            ORDER BY ml.eaten_date ASC, ml.created_at ASC, ml.id ASC
          `

          return { aggregateRaw, entryRaw }
        })(),
        (caughtErr) =>
          new MealHistoryQueryError('meal history query failed', caughtErr),
      ).andThen(({ aggregateRaw, entryRaw }) => {
        const aggregateParsed = z
          .array(aggregateRowSchema)
          .safeParse(aggregateRaw)
        if (!aggregateParsed.success) {
          return err(
            new MealHistoryQueryError(
              'meal history aggregate rows are invalid',
              aggregateParsed.error,
            ),
          )
        }
        const entryParsed = z.array(entryRowSchema).safeParse(entryRaw)
        if (!entryParsed.success) {
          return err(
            new MealHistoryQueryError(
              'meal history entry rows are invalid',
              entryParsed.error,
            ),
          )
        }

        const perDay = buildPerDay(aggregateParsed.data)
        const totals = sumPerDay(perDay)
        const entries: MealLogEntry[] = entryParsed.data.map((row) => ({
          id: row.id,
          foodMasterId: row.food_master_id,
          foodName: row.food_name,
          eatenDate: row.eaten_date,
          mealType: row.meal_type,
          quantity: row.quantity,
          unit: row.unit,
        }))
        const hasEstimatedValues = entryParsed.data.some(
          (row) => row.is_estimated,
        )

        return ok({ totals, perDay, entries, hasEstimatedValues })
      })
    },
  }
}

const buildPerDay = (
  rows: ReadonlyArray<{
    day: string
    nutrient_code: NutrientCode
    value: number
  }>,
): ReadonlyArray<MealHistoryDayTotals> => {
  const byDay = new Map<string, Record<NutrientCode, number>>()
  for (const row of rows) {
    const day = byDay.get(row.day) ?? {}
    day[row.nutrient_code] = row.value
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
