import { err, errAsync, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
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
  NutritionStatus,
} from '#domain/food-master/types'
import {
  normalizeAndValidateNutrition,
  type NormalizedNutritionInput,
} from '#domain/food-master/validation'

const FOOD_MASTER_NUTRITION_PRIMARY_KEY = 'food_master_nutrition_pkey'
const FOOD_MASTER_NUTRITION_FOOD_MASTER_ID_FK =
  'food_master_nutrition_food_master_id_fk'

const existingNutritionRowsSchema = z.array(
  z.object({
    id: z.string(),
    source: z.enum(foodSourceEnum.enumValues),
  }),
)
const nutritionVersionRowSchema = z.object({ id: z.string() })

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
) => ResultAsync<
  Exclude<NutritionStatus, 'unknown'>,
  FoodMasterDomainError
>) => {
  const fillInTx = async (
    tx: Sql | TxSql,
    input: FillFoodNutritionInput,
    normalized: NormalizedNutritionInput,
  ) => {
    const nutrientCodes = Object.keys(normalized.nutrition)
    const known = await tx<{ code: string }[]>`
      SELECT code FROM nutrient_definitions
      WHERE code IN ${tx(nutrientCodes)}
    `
    const knownSet = new Set(known.map((row) => row.code))
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

    const foodMasters = await tx<{ id: string }[]>`
      SELECT id FROM food_masters
      WHERE id = ${input.foodMasterId}
      FOR UPDATE
    `
    if (foodMasters.length === 0) {
      return err(
        new FoodMasterDomainError(
          'food_master_not_found',
          `food_master not found: ${input.foodMasterId}`,
          { foodMasterId: input.foodMasterId },
        ),
      )
    }

    const existingNutrition = await tx<Record<string, unknown>[]>`
      SELECT id, source FROM food_master_nutrition
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

    let nutritionVersionId: string
    if (existingSource === 'model_estimate' && existingVersion !== undefined) {
      nutritionVersionId = existingVersion.id
      await tx`
        UPDATE food_master_nutrition
        SET is_estimated = ${normalized.isEstimated},
            source = ${normalized.source},
            source_url = ${normalized.sourceUrl},
            source_composition_code = ${normalized.sourceCompositionCode},
            legacy_evidence = false
        WHERE id = ${nutritionVersionId}
      `
      await tx`
        DELETE FROM food_master_nutrients
        WHERE nutrition_version_id = ${nutritionVersionId}
      `
    } else {
      const insertedVersion = await tx<Record<string, unknown>[]>`
        INSERT INTO food_master_nutrition (
          food_master_id, version_no, is_current, change_kind, is_estimated,
          source, source_url, source_composition_code
        )
        VALUES (
          ${input.foodMasterId}, 1, true, 'initial',
          ${normalized.isEstimated},
          ${normalized.source},
          ${normalized.sourceUrl},
          ${normalized.sourceCompositionCode}
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
      nutritionVersionId = parsedVersion.data[0].id
    }

    const nutrientRows = nutrientCodes.map((code) => ({
      nutrition_version_id: nutritionVersionId,
      nutrient_code: code,
      value: String(normalized.nutrition[code]),
    }))
    await tx`INSERT INTO food_master_nutrients ${tx(nutrientRows, 'nutrition_version_id', 'nutrient_code', 'value')}`

    if (existingVersion === undefined) {
      await tx`
        WITH filled_logs AS (
          UPDATE meal_logs
          SET nutrition_version_id = ${nutritionVersionId},
              nutrition_version_origin = 'filled'
          WHERE food_master_id = ${input.foodMasterId}
            AND nutrition_version_id IS NULL
          RETURNING id
        )
        INSERT INTO meal_log_nutrition_changes (
          meal_log_id, from_version_id, to_version_id, reason
        )
        SELECT id, NULL, ${nutritionVersionId}, '補完'
        FROM filled_logs
      `
    }

    return ok(
      normalized.isEstimated ? ('estimated' as const) : ('confirmed' as const),
    )
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
