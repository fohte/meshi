import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { createAsText, type Sql } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import { foodSourceEnum } from '#db/schema'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import {
  type MealHistoryDayTotals,
  type MealHistoryNutritionVersion,
  MealHistoryQueryError,
  type MealHistoryService,
  type MealLogEntry,
  type NutrientCode,
  NUTRITION_VERSION_CHANGE_KINDS,
  NUTRITION_VERSION_ORIGINS,
  type NutritionMap,
} from '#domain/meal-history/types'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { type JstDate, jstDateSchema } from '#lib/jst-date'

const aggregateRowSchema = z.object({
  day: jstDateSchema,
  nutrient_code: z.string(),
  value: numericValueSchema,
})

const incompleteNutrientRowSchema = z.object({
  day: jstDateSchema,
  nutrient_code: z.string(),
})

const nutritionVersionRowSchema = z.object({
  version_no: z.number().int().positive(),
  change_kind: z.enum(NUTRITION_VERSION_CHANGE_KINDS),
  source: z.enum(foodSourceEnum.enumValues),
  is_estimated: z.boolean(),
  checked_on: z.iso.date().nullable(),
  effective_from: z.iso.date().nullable(),
})

const entryRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  food_name: z.string(),
  eaten_date: jstDateSchema,
  meal_type: z.enum(MEAL_TYPES),
  quantity: numericValueSchema,
  recorded_at: z.iso.datetime({ offset: true }),
  is_estimated: z.boolean().nullable(),
  nutrition_version: nutritionVersionRowSchema.nullable(),
  nutrition_version_origin: z.enum(NUTRITION_VERSION_ORIGINS),
  nutrition_version_differences: z.array(nutritionVersionRowSchema),
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
                INNER JOIN food_master_nutrition nutrition
                  ON nutrition.id = ml.nutrition_version_id
                INNER JOIN food_master_nutrients fmn
                  ON fmn.nutrition_version_id = nutrition.id
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
                      ON fmn.nutrition_version_id = ml.nutrition_version_id
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
                      AND fmn.nutrition_version_id IS NULL
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
                  nutrition.is_estimated AS is_estimated,
                  CASE
                    WHEN nutrition.id IS NULL THEN NULL
                    ELSE jsonb_build_object(
                      'version_no', nutrition.version_no,
                      'change_kind', nutrition.change_kind,
                      'source', nutrition.source,
                      'is_estimated', nutrition.is_estimated,
                      'checked_on', to_char(nutrition.checked_on, 'YYYY-MM-DD'),
                      'effective_from', to_char(nutrition.effective_from, 'YYYY-MM-DD')
                    )
                  END AS nutrition_version,
                  ml.nutrition_version_origin AS nutrition_version_origin,
                  version_differences.versions AS nutrition_version_differences
                FROM meal_logs ml
                INNER JOIN food_masters fm ON fm.id = ml.food_master_id
                LEFT JOIN food_master_nutrition nutrition
                  ON nutrition.id = ml.nutrition_version_id
                  AND nutrition.food_master_id = ml.food_master_id
                LEFT JOIN LATERAL (
                  SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'version_no', alternative.version_no,
                        'change_kind', alternative.change_kind,
                        'source', alternative.source,
                        'is_estimated', alternative.is_estimated,
                        'checked_on', to_char(alternative.checked_on, 'YYYY-MM-DD'),
                        'effective_from', to_char(alternative.effective_from, 'YYYY-MM-DD')
                      ) ORDER BY alternative.version_no
                    ),
                    '[]'::jsonb
                  ) AS versions
                  FROM food_master_nutrition alternative
                  WHERE nutrition.id IS NOT NULL
                    AND alternative.food_master_id = ml.food_master_id
                    AND alternative.id <> nutrition.id
                    AND EXISTS (
                      SELECT 1
                      FROM (
                        SELECT nutrient_code
                        FROM food_master_nutrients
                        WHERE nutrition_version_id = nutrition.id
                        UNION
                        SELECT nutrient_code
                        FROM food_master_nutrients
                        WHERE nutrition_version_id = alternative.id
                      ) nutrient_codes
                      LEFT JOIN food_master_nutrients selected_value
                        ON selected_value.nutrition_version_id = nutrition.id
                        AND selected_value.nutrient_code = nutrient_codes.nutrient_code
                      LEFT JOIN food_master_nutrients alternative_value
                        ON alternative_value.nutrition_version_id = alternative.id
                        AND alternative_value.nutrient_code = nutrient_codes.nutrient_code
                      WHERE selected_value.value IS DISTINCT FROM alternative_value.value
                    )
                ) version_differences ON true
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
          nutritionVersion:
            row.nutrition_version === null
              ? null
              : mapNutritionVersion(row.nutrition_version),
          nutritionVersionOrigin: row.nutrition_version_origin,
          nutritionVersionDifferences:
            row.nutrition_version_differences.map(mapNutritionVersion),
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

const mapNutritionVersion = (
  version: z.infer<typeof nutritionVersionRowSchema>,
): MealHistoryNutritionVersion => ({
  versionNo: version.version_no,
  changeKind: version.change_kind,
  source: version.source,
  isEstimated: version.is_estimated,
  checkedOn: version.checked_on,
  effectiveFrom: version.effective_from,
})

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
  type DayTotals = {
    totals: Record<NutrientCode, number>
    incompleteNutrients: Set<NutrientCode>
    hasUnknownValues: boolean
  }
  const byDay = new Map<JstDate, DayTotals>()
  const dayFor = (date: JstDate) => {
    const existing = byDay.get(date)
    if (existing) return existing

    const day: DayTotals = {
      totals: {},
      incompleteNutrients: new Set<NutrientCode>(),
      hasUnknownValues: unknownDays.has(date),
    }
    byDay.set(date, day)
    return day
  }

  for (const date of entryDays) {
    dayFor(date)
  }
  for (const row of rows) {
    const day = dayFor(row.day)
    day.totals[row.nutrient_code] = row.value
  }
  for (const row of incompleteNutrientRows) {
    const day = dayFor(row.day)
    day.incompleteNutrients.add(row.nutrient_code)
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
