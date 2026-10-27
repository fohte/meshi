import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { numericValueSchema } from '#db/numeric-value-schema'
import {
  getConstraintName,
  isForeignKeyViolation,
  isUniqueViolation,
} from '#db/pg-error'
import { foodSourceEnum } from '#db/schema'
import { errorMessage, FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import type { TxSql } from '#domain/food-master/rows'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  FillFoodNutritionInput,
  FillFoodNutritionResult,
  NutritionMap,
} from '#domain/food-master/types'
import {
  normalizeAndValidateNutrition,
  type NormalizedNutritionInput,
} from '#domain/food-master/validation'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

const FOOD_MASTER_NUTRITION_PRIMARY_KEY = 'food_master_nutrition_pkey'
const FOOD_MASTER_NUTRITION_FOOD_MASTER_ID_FK =
  'food_master_nutrition_food_master_id_fk'

const existingNutritionRowsSchema = z.array(
  z.object({
    id: z.string(),
    source: z.enum(foodSourceEnum.enumValues),
    version_no: z.number().int(),
  }),
)
const nutritionVersionRowSchema = z.object({ id: z.string() })
const foodMasterRowSchema = z.object({ id: z.string() })
const maxVersionRowSchema = z.object({ max_version_no: z.number().int() })
const assignedMealLogRowsSchema = z.array(
  z.object({
    id: z.string(),
    eaten_date: jstDateSchema,
    meal_type: z.enum(MEAL_TYPES),
    quantity: numericValueSchema,
  }),
)
const dailyNutritionRowsSchema = z.array(
  z.object({
    date: jstDateSchema,
    nutrient_code: z.string(),
    value: numericValueSchema,
  }),
)
const nutrientCodeRowsSchema = z.array(z.object({ code: z.string() }))

const readDailyTotals = async (
  tx: Sql | TxSql,
  dates: ReadonlyArray<string>,
): Promise<
  Result<ReadonlyMap<string, NutritionMap>, FoodMasterDomainError>
> => {
  const totals = new Map<string, Record<string, number>>(
    dates.map((date) => [date, {}]),
  )
  if (dates.length === 0) return ok(totals)

  const rawRows = await tx<Record<string, unknown>[]>`
    SELECT to_char(ml.eaten_date, 'YYYY-MM-DD') AS date,
           nutrients.nutrient_code,
           SUM(nutrients.value * ml.quantity) AS value
    FROM meal_logs AS ml
    JOIN food_master_nutrients AS nutrients
      ON nutrients.nutrition_version_id = ml.nutrition_version_id
    WHERE ml.eaten_date = ANY(${tx.array([...dates])}::date[])
    GROUP BY date, nutrients.nutrient_code
    ORDER BY date, nutrients.nutrient_code
  `
  const parsedRows = dailyNutritionRowsSchema.safeParse(rawRows)
  if (!parsedRows.success) {
    return err(
      new FoodMasterDomainError(
        'persistence_failed',
        `daily nutrition totals query returned invalid rows: ${parsedRows.error.message}`,
      ),
    )
  }

  for (const row of parsedRows.data) {
    const day = totals.get(row.date)
    if (day !== undefined) day[row.nutrient_code] = row.value
  }
  return ok(totals)
}

const nutritionAlreadyExists = (foodMasterId: string, cause?: unknown) =>
  new FoodMasterDomainError(
    'nutrition_already_exists',
    'food_master already has nutrition metadata',
    { foodMasterId },
    cause,
  )

const toFillNutritionError = (
  caughtErr: unknown,
  foodMasterId: string,
): FoodMasterDomainError => {
  const constraint = getConstraintName(caughtErr)
  if (
    isUniqueViolation(caughtErr) &&
    constraint === FOOD_MASTER_NUTRITION_PRIMARY_KEY
  ) {
    return nutritionAlreadyExists(foodMasterId, caughtErr)
  }
  if (
    isForeignKeyViolation(caughtErr) &&
    constraint === FOOD_MASTER_NUTRITION_FOOD_MASTER_ID_FK
  ) {
    return new FoodMasterDomainError(
      'food_master_not_found',
      `food_master not found: ${foodMasterId}`,
      { foodMasterId },
      caughtErr,
    )
  }
  return new FoodMasterDomainError(
    'persistence_failed',
    errorMessage(caughtErr),
    {},
    caughtErr,
  )
}

export const createFoodMasterNutritionFiller = (
  sql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
): ((
  input: FillFoodNutritionInput,
) => ResultAsync<FillFoodNutritionResult, FoodMasterDomainError>) => {
  const fillInTx = async (
    tx: Sql | TxSql,
    input: FillFoodNutritionInput,
    normalized: NormalizedNutritionInput,
  ): Promise<Result<FillFoodNutritionResult, FoodMasterDomainError>> => {
    const nutrientCodes = Object.keys(normalized.nutrition)
    const knownRows = await tx<Record<string, unknown>[]>`
      SELECT code FROM nutrient_definitions
      WHERE code IN ${tx(nutrientCodes)}
    `
    const parsedKnownRows = nutrientCodeRowsSchema.safeParse(knownRows)
    if (!parsedKnownRows.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `nutrient_definitions query returned invalid rows: ${parsedKnownRows.error.message}`,
        ),
      )
    }
    const knownSet = new Set(parsedKnownRows.data.map((row) => row.code))
    const unknown = nutrientCodes.filter((code) => !knownSet.has(code))
    if (unknown.length > 0) {
      return err(
        new FoodMasterDomainError(
          'unknown_nutrient_code',
          `nutrient_code not registered in nutrient_definitions: ${unknown.join(', ')}`,
          { unknown },
        ),
      )
    }

    const foodMasters = await tx<Record<string, unknown>[]>`
      SELECT id FROM food_masters
      WHERE id = ${input.foodMasterId}
      FOR UPDATE
    `
    const parsedFoodMasters = z
      .array(foodMasterRowSchema)
      .safeParse(foodMasters)
    if (!parsedFoodMasters.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `food_masters query returned invalid rows: ${parsedFoodMasters.error.message}`,
        ),
      )
    }
    if (parsedFoodMasters.data.length === 0) {
      return err(
        new FoodMasterDomainError(
          'food_master_not_found',
          `food_master not found: ${input.foodMasterId}`,
          { foodMasterId: input.foodMasterId },
        ),
      )
    }

    const existingNutrition = await tx<Record<string, unknown>[]>`
      SELECT id, source, version_no FROM food_master_nutrition
      WHERE food_master_id = ${input.foodMasterId} AND is_current = true
    `
    const parsedExistingNutrition =
      existingNutritionRowsSchema.safeParse(existingNutrition)
    if (!parsedExistingNutrition.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `food_master_nutrition query returned invalid rows: ${parsedExistingNutrition.error.message}`,
        ),
      )
    }
    const existingVersion = parsedExistingNutrition.data[0]
    const existingSource = existingVersion?.source
    if (
      existingSource !== undefined &&
      (existingSource !== 'model_estimate' ||
        normalized.source === 'model_estimate')
    ) {
      return err(nutritionAlreadyExists(input.foodMasterId))
    }

    const maxVersionRows = await tx<Record<string, unknown>[]>`
      SELECT COALESCE(MAX(version_no), 0)::int AS max_version_no
      FROM food_master_nutrition
      WHERE food_master_id = ${input.foodMasterId}
    `
    const parsedMaxVersionRows = z
      .array(maxVersionRowSchema)
      .safeParse(maxVersionRows)
    if (
      !parsedMaxVersionRows.success ||
      parsedMaxVersionRows.data[0] === undefined
    ) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          parsedMaxVersionRows.success
            ? 'food_master_nutrition max version query returned no rows'
            : `food_master_nutrition max version query returned invalid rows: ${parsedMaxVersionRows.error.message}`,
        ),
      )
    }
    const nutritionVersionNo = parsedMaxVersionRows.data[0].max_version_no + 1

    const unassignedMealLogRows = await tx<Record<string, unknown>[]>`
      SELECT id, to_char(eaten_date, 'YYYY-MM-DD') AS eaten_date,
             meal_type, quantity
      FROM meal_logs
      WHERE food_master_id = ${input.foodMasterId}
        AND nutrition_version_id IS NULL
      ORDER BY eaten_date, created_at, id
    `
    const parsedUnassignedMealLogs = assignedMealLogRowsSchema.safeParse(
      unassignedMealLogRows,
    )
    if (!parsedUnassignedMealLogs.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `unassigned meal_logs query returned invalid rows: ${parsedUnassignedMealLogs.error.message}`,
        ),
      )
    }
    const affectedDates = [
      ...new Set(parsedUnassignedMealLogs.data.map((row) => row.eaten_date)),
    ].toSorted()
    const dailyTotalsBeforeResult = await readDailyTotals(tx, affectedDates)
    if (dailyTotalsBeforeResult.isErr())
      return err(dailyTotalsBeforeResult.error)

    if (existingVersion !== undefined) {
      await tx`
        UPDATE food_master_nutrition SET is_current = false
        WHERE id = ${existingVersion.id}
      `
    }

    const insertedVersion = await tx<Record<string, unknown>[]>`
      INSERT INTO food_master_nutrition (
        food_master_id, version_no, is_current, change_kind,
        corrects_version_id, reason, is_estimated, source,
        source_url, source_composition_code
      )
      VALUES (
        ${input.foodMasterId}, ${nutritionVersionNo}, true,
        ${existingVersion === undefined ? 'initial' : 'correction'},
        ${existingVersion?.id ?? null},
        ${existingVersion === undefined ? null : '推定値の栄養値を補完により訂正'},
        ${normalized.isEstimated}, ${normalized.source},
        ${normalized.sourceUrl}, ${normalized.sourceCompositionCode}
      )
      RETURNING id
    `
    const parsedVersion = z
      .array(nutritionVersionRowSchema)
      .safeParse(insertedVersion)
    if (!parsedVersion.success || parsedVersion.data[0] === undefined) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          'failed to insert food_master_nutrition row',
        ),
      )
    }
    const nutritionVersionId = parsedVersion.data[0].id

    const nutrientRows = nutrientCodes.map((code) => ({
      nutrition_version_id: nutritionVersionId,
      nutrient_code: code,
      value: String(normalized.nutrition[code]),
    }))
    await tx`INSERT INTO food_master_nutrients ${tx(nutrientRows, 'nutrition_version_id', 'nutrient_code', 'value')}`

    const filledMealLogRows = await tx<Record<string, unknown>[]>`
      WITH filled_logs AS (
        UPDATE meal_logs
        SET nutrition_version_id = ${nutritionVersionId},
            nutrition_version_origin = 'filled'
        WHERE food_master_id = ${input.foodMasterId}
          AND nutrition_version_id IS NULL
        RETURNING id, to_char(eaten_date, 'YYYY-MM-DD') AS eaten_date,
                  meal_type, quantity
      ), changes AS (
        INSERT INTO meal_log_nutrition_changes (
          meal_log_id, from_version_id, to_version_id, reason
        )
        SELECT id, NULL, ${nutritionVersionId}, '補完' FROM filled_logs
        RETURNING meal_log_id
      )
      SELECT id, eaten_date, meal_type, quantity
      FROM filled_logs
    `
    const parsedFilledMealLogs =
      assignedMealLogRowsSchema.safeParse(filledMealLogRows)
    if (!parsedFilledMealLogs.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `filled meal_logs query returned invalid rows: ${parsedFilledMealLogs.error.message}`,
        ),
      )
    }
    const dailyTotalsAfterResult = await readDailyTotals(tx, affectedDates)
    if (dailyTotalsAfterResult.isErr()) return err(dailyTotalsAfterResult.error)

    const affectedDayTotals = affectedDates.map((date) => ({
      date,
      totalsBefore: dailyTotalsBeforeResult.value.get(date) ?? {},
      totalsAfter: dailyTotalsAfterResult.value.get(date) ?? {},
    }))

    return ok({
      nutritionStatus: normalized.isEstimated ? 'estimated' : 'confirmed',
      nutritionVersionNo,
      assignedMealLogs: parsedFilledMealLogs.data.map((row) => ({
        id: row.id,
        eatenDate: row.eaten_date,
        mealType: row.meal_type,
        quantity: row.quantity,
      })),
      affectedDayTotals,
    })
  }

  return (input) => {
    const normalizedResult = normalizeAndValidateNutrition(input)
    if (normalizedResult.isErr()) return errAsync(normalizedResult.error)
    const normalized = normalizedResult.value
    const settle = wrapInTransaction
      ? sql.begin((tx) => fillInTx(tx, input, normalized))
      : runInSavepoint(sql, generateId, (tx) => fillInTx(tx, input, normalized))

    return ResultAsync.fromPromise(settle, (caughtErr) =>
      toFillNutritionError(caughtErr, input.foodMasterId),
    ).andThen((result) => result)
  }
}
