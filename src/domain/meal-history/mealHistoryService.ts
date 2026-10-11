import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { createAsText, type Sql } from '#db/index'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import type {
  MealHistoryDayTotals,
  MealHistoryService,
  MealLogEntry,
  NutrientCode,
  NutritionMap,
} from '#domain/meal-history/types'
import { MealHistoryQueryError } from '#domain/meal-history/types'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

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
  day: jstDateSchema,
  nutrient_code: z.string(),
  value: numericString,
})

const incompleteNutrientRowSchema = z.object({
  day: jstDateSchema,
  nutrient_code: z.string(),
})

const entryRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  eaten_date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  quantity: numericString,
  recorded_at: z.iso.datetime({ offset: true }),
  is_estimated: z.boolean().nullable(),
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
      const periodFrom = asText(input.periodFrom)
      const periodTo = asText(input.periodTo)

      return ResultAsync.fromPromise(
        (async () => {
          const [aggregateRaw, incompleteNutrientRaw, entryRaw] =
            await Promise.all([
              emptyNutrientFilter
                ? Promise.resolve([])
                : sql`
                SELECT
                  to_char(ml.eaten_date, 'YYYY-MM-DD') AS day,
                  fmn.nutrient_code AS nutrient_code,
                  SUM(fmn.value * ml.quantity) AS value
                FROM meal_logs ml
                INNER JOIN food_master_nutrients fmn
                  ON fmn.food_master_id = ml.food_master_id
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
              `,
              emptyNutrientFilter
                ? Promise.resolve([])
                : sql`
                    SELECT
                      to_char(ml.eaten_date, 'YYYY-MM-DD') AS day,
                      nd.code AS nutrient_code
                    FROM meal_logs ml
                    CROSS JOIN nutrient_definitions nd
                    LEFT JOIN food_master_nutrients fmn
                      ON fmn.food_master_id = ml.food_master_id
                      AND fmn.nutrient_code = nd.code
                    WHERE ml.eaten_date >= ${periodFrom}::date
                      AND ml.eaten_date < ${periodTo}::date
                      AND (
                        ${foodFilter === null}::boolean
                        OR ml.food_master_id = ANY(${foodFilter ?? []}::text[])
                      )
                      AND (
                        CASE
                          WHEN ${useMajorOnly}::boolean THEN nd.is_major = true
                          ELSE nd.code = ANY(${nutrientCodes ?? []}::text[])
                        END
                      )
                      AND fmn.food_master_id IS NULL
                    GROUP BY day, nd.code
                    ORDER BY day, nd.code
                  `,
              sql`
                SELECT
                  ml.id AS id,
                  ml.food_master_id AS food_master_id,
                  fm.name AS food_name,
                  to_char(ml.eaten_date, 'YYYY-MM-DD') AS eaten_date,
                  ml.meal_type AS meal_type,
                  ml.quantity AS quantity,
                  to_char(
                    ml.created_at AT TIME ZONE 'UTC',
                    'YYYY-MM-DD"T"HH24:MI:SS"Z"'
                  ) AS recorded_at,
                  fmn.is_estimated AS is_estimated
                FROM meal_logs ml
                INNER JOIN food_masters fm ON fm.id = ml.food_master_id
                LEFT JOIN food_master_nutrition fmn ON fmn.food_master_id = fm.id
                WHERE ml.eaten_date >= ${periodFrom}::date
                  AND ml.eaten_date < ${periodTo}::date
                  AND (
                    ${foodFilter === null}::boolean
                    OR ml.food_master_id = ANY(${foodFilter ?? []}::text[])
                  )
                ORDER BY ml.eaten_date ASC, ml.created_at ASC, ml.id ASC
              `,
            ])

          return { aggregateRaw, incompleteNutrientRaw, entryRaw }
        })(),
        (caughtErr) =>
          new MealHistoryQueryError('meal history query failed', caughtErr),
      ).andThen(({ aggregateRaw, incompleteNutrientRaw, entryRaw }) => {
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
        const incompleteNutrientParsed = z
          .array(incompleteNutrientRowSchema)
          .safeParse(incompleteNutrientRaw)
        if (!incompleteNutrientParsed.success) {
          return err(
            new MealHistoryQueryError(
              'meal history incomplete nutrient rows are invalid',
              incompleteNutrientParsed.error,
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

        const perDay = buildPerDay(
          aggregateParsed.data,
          incompleteNutrientParsed.data,
          entryParsed.data.map((row) => row.eaten_date),
          new Set(
            entryParsed.data
              .filter(
                (row) =>
                  nutritionStatusFromIsEstimated(row.is_estimated) ===
                  'unknown',
              )
              .map((row) => row.eaten_date),
          ),
        )
        const totals = sumPerDay(perDay)
        const incompleteNutrients = [
          ...new Set(perDay.flatMap((day) => day.incompleteNutrients)),
        ].sort()
        const entries: MealLogEntry[] = entryParsed.data.map((row) => ({
          id: row.id,
          foodMasterId: row.food_master_id,
          foodName: row.food_name,
          eatenDate: row.eaten_date,
          mealType: row.meal_type,
          quantity: row.quantity,
          recordedAt: row.recorded_at,
          nutritionStatus: nutritionStatusFromIsEstimated(row.is_estimated),
        }))
        const hasEstimatedValues = entryParsed.data.some(
          (row) =>
            nutritionStatusFromIsEstimated(row.is_estimated) === 'estimated',
        )
        const hasUnknownValues = entryParsed.data.some(
          (row) =>
            nutritionStatusFromIsEstimated(row.is_estimated) === 'unknown',
        )

        return ok({
          totals,
          incompleteNutrients,
          perDay,
          entries,
          hasEstimatedValues,
          hasUnknownValues,
        })
      })
    },
  }
}

const buildPerDay = (
  rows: ReadonlyArray<{
    day: JstDate
    nutrient_code: NutrientCode
    value: number
  }>,
  incompleteNutrientRows: ReadonlyArray<{
    day: JstDate
    nutrient_code: NutrientCode
  }>,
  entryDays: ReadonlyArray<JstDate>,
  unknownDays: ReadonlySet<JstDate>,
): ReadonlyArray<MealHistoryDayTotals> => {
  const byDay = new Map<
    JstDate,
    {
      totals: Record<NutrientCode, number>
      incompleteNutrients: Set<NutrientCode>
      hasUnknownValues: boolean
    }
  >()
  for (const date of entryDays) {
    byDay.set(date, {
      totals: {},
      incompleteNutrients: new Set(),
      hasUnknownValues: unknownDays.has(date),
    })
  }
  for (const row of rows) {
    const day = byDay.get(row.day) ?? {
      totals: {},
      incompleteNutrients: new Set<NutrientCode>(),
      hasUnknownValues: false,
    }
    day.totals[row.nutrient_code] = row.value
    byDay.set(row.day, day)
  }
  for (const row of incompleteNutrientRows) {
    const day = byDay.get(row.day) ?? {
      totals: {},
      incompleteNutrients: new Set<NutrientCode>(),
      hasUnknownValues: false,
    }
    day.incompleteNutrients.add(row.nutrient_code)
    byDay.set(row.day, day)
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, day]) => ({
      date,
      totals: day.totals,
      incompleteNutrients: [...day.incompleteNutrients].sort(),
      hasUnknownValues: day.hasUnknownValues,
    }))
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
