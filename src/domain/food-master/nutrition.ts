import { err, errAsync, ok, ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import {
  getConstraintName,
  isForeignKeyViolation,
  isUniqueViolation,
} from '#db/pg-error'
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

const toFillNutritionError = (
  caughtErr: unknown,
  foodMasterId: string,
): FoodMasterDomainError => {
  const constraint = getConstraintName(caughtErr)
  if (
    isUniqueViolation(caughtErr) &&
    constraint === FOOD_MASTER_NUTRITION_PRIMARY_KEY
  ) {
    return new FoodMasterDomainError(
      'nutrition_already_exists',
      'food_master already has nutrition metadata',
      { foodMasterId },
      caughtErr,
    )
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

    await tx`
      INSERT INTO food_master_nutrition (
        food_master_id, is_estimated, source, source_url, source_composition_code
      )
      VALUES (
        ${input.foodMasterId},
        ${normalized.isEstimated},
        ${normalized.source},
        ${normalized.sourceUrl},
        ${normalized.sourceCompositionCode}
      )
    `

    const nutrientRows = nutrientCodes.map((code) => ({
      food_master_id: input.foodMasterId,
      nutrient_code: code,
      value: String(normalized.nutrition[code]),
    }))
    await tx`INSERT INTO food_master_nutrients ${tx(nutrientRows, 'food_master_id', 'nutrient_code', 'value')}`

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
