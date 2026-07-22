import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '@/db'
import type {
  MealHistoryDayTotals,
  MealHistoryService,
  MealLogEntry,
  NutrientCode,
  NutritionMap,
} from '@/domain/meal-history/types'
import { MealHistoryQueryError } from '@/domain/meal-history/types'

const PER_100G_BASE = 100

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
  eaten_at: z.date(),
  quantity: numericString,
  unit: z.string(),
  note: z.string().nullable(),
  is_estimated: z.boolean(),
})

export const createMealHistoryService = (sql: Sql): MealHistoryService => ({
  query(input) {
    const foodFilter =
      input.foodFilter !== undefined && input.foodFilter.length > 0
        ? input.foodFilter
        : null
    const nutrientCodes = input.nutrientCodes
    const useMajorOnly = nutrientCodes === undefined
    const emptyNutrientFilter =
      nutrientCodes !== undefined && nutrientCodes.length === 0

    return ResultAsync.fromPromise(
      (async () => {
        const aggregateRaw = emptyNutrientFilter
          ? []
          : await sql`
              SELECT
                to_char(date_trunc('day', ml.eaten_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
                  AS day,
                fmn.nutrient_code AS nutrient_code,
                SUM(fmn.value * ml.quantity / ${PER_100G_BASE}) AS value
              FROM meal_logs ml
              INNER JOIN food_master_nutrients fmn
                ON fmn.food_master_id = ml.food_master_id
              WHERE ml.eaten_at >= ${input.periodFrom}
                AND ml.eaten_at < ${input.periodTo}
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
            ml.eaten_at AS eaten_at,
            ml.quantity AS quantity,
            ml.unit AS unit,
            ml.note AS note,
            fm.is_estimated AS is_estimated
          FROM meal_logs ml
          INNER JOIN food_masters fm ON fm.id = ml.food_master_id
          WHERE ml.eaten_at >= ${input.periodFrom}
            AND ml.eaten_at < ${input.periodTo}
            AND (
              ${foodFilter === null}::boolean
              OR ml.food_master_id = ANY(${foodFilter ?? []}::text[])
            )
          ORDER BY ml.eaten_at ASC, ml.id ASC
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
        eatenAt: row.eaten_at,
        quantity: row.quantity,
        unit: row.unit,
        note: row.note,
      }))
      const hasEstimatedValues = entryParsed.data.some(
        (row) => row.is_estimated,
      )

      return ok({ totals, perDay, entries, hasEstimatedValues })
    })
  },
})

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
