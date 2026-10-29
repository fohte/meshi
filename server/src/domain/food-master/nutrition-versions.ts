import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql, SqlOrTx } from '#db/index'
import { foodSourceEnum } from '#db/schema'
import { errorMessage, FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  AddFoodMasterNutritionVersionInput,
  FoodMasterNutritionVersion,
} from '#domain/food-master/types'
import {
  normalizeAndValidateNutrition,
  type NormalizedNutritionInput,
} from '#domain/food-master/validation'

const foodMasterRowSchema = z.object({ id: z.string() })
const nutritionVersionStateSchema = z.object({
  id: z.string(),
  is_current: z.boolean(),
  serving_basis: z.string().nullable(),
  net_content: z.string().nullable(),
  effective_from: z.string().nullable(),
})
const maxVersionRowSchema = z.object({ max_version_no: z.number().int() })
const nutritionVersionRowSchema = z.object({
  id: z.string(),
  food_master_id: z.string(),
  version_no: z.number().int(),
  change_kind: z.enum(['initial', 'product_update', 'correction']),
  corrects_version_id: z.string().nullable(),
  is_current: z.boolean(),
  serving_basis: z.string().nullable(),
  net_content: z.string().nullable(),
  nutrition: z.record(z.string(), z.number()),
  source: z.enum(foodSourceEnum.enumValues),
  source_url: z.string().nullable(),
  source_composition_code: z.string().nullable(),
  is_estimated: z.boolean(),
  checked_on: z.string().nullable(),
  effective_from: z.string().nullable(),
  reason: z.string().nullable(),
  meal_log_count: z.number().int().nonnegative(),
})

const toVersion = (
  row: z.infer<typeof nutritionVersionRowSchema>,
): FoodMasterNutritionVersion => ({
  id: row.id,
  foodMasterId: row.food_master_id,
  versionNo: row.version_no,
  changeKind: row.change_kind,
  correctsVersionId: row.corrects_version_id,
  isCurrent: row.is_current,
  servingBasis: row.serving_basis,
  netContent: row.net_content,
  nutrition: row.nutrition,
  source: row.source,
  sourceUrl: row.source_url,
  sourceCompositionCode: row.source_composition_code,
  isEstimated: row.is_estimated,
  checkedOn: row.checked_on,
  effectiveFrom: row.effective_from,
  reason: row.reason,
  mealLogCount: row.meal_log_count,
})

const invalidChange = (message: string): FoodMasterDomainError =>
  new FoodMasterDomainError('invalid_nutrition_version_change', message)

const normalizeOptionalText = (
  value: string | null | undefined,
): string | null => {
  const normalized = value?.trim()
  return normalized === undefined || normalized === '' ? null : normalized
}

const validateChange = (
  input: AddFoodMasterNutritionVersionInput,
): Result<void, FoodMasterDomainError> => {
  if (input.changeKind === 'product_update') {
    if (input.checkedOn === undefined) {
      return err(
        invalidChange("change_kind='product_update' requires checked_on"),
      )
    }
    if (input.correctsVersionId !== undefined || input.reason !== undefined) {
      return err(
        invalidChange(
          "change_kind='product_update' must not include corrects_version_id or reason",
        ),
      )
    }
    return ok(undefined)
  }

  if (
    input.correctsVersionId === undefined ||
    input.correctsVersionId.trim() === ''
  ) {
    return err(
      invalidChange("change_kind='correction' requires corrects_version_id"),
    )
  }
  if (input.reason === undefined || input.reason.trim() === '') {
    return err(invalidChange("change_kind='correction' requires reason"))
  }
  return ok(undefined)
}

const toPersistenceError = (caughtErr: unknown): FoodMasterDomainError =>
  new FoodMasterDomainError(
    'persistence_failed',
    errorMessage(caughtErr),
    {},
    caughtErr,
  )

export const createFoodMasterNutritionVersionOperations = (
  sql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
): {
  readonly add: (
    input: AddFoodMasterNutritionVersionInput,
  ) => ResultAsync<FoodMasterNutritionVersion, FoodMasterDomainError>
  readonly list: (
    foodMasterId: string,
  ) => ResultAsync<
    ReadonlyArray<FoodMasterNutritionVersion>,
    FoodMasterDomainError
  >
} => {
  const addInTx = async (
    tx: SqlOrTx,
    input: AddFoodMasterNutritionVersionInput,
    normalized: NormalizedNutritionInput,
  ): Promise<Result<FoodMasterNutritionVersion, FoodMasterDomainError>> => {
    const nutrientCodes = Object.keys(normalized.nutrition)
    const rawKnownRows = await tx<Record<string, unknown>[]>`
      SELECT code FROM nutrient_definitions
      WHERE code IN ${tx(nutrientCodes)}
    `
    const parsedKnownRows = z
      .array(z.object({ code: z.string() }))
      .safeParse(rawKnownRows)
    if (!parsedKnownRows.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `nutrient_definitions query returned invalid rows: ${parsedKnownRows.error.message}`,
        ),
      )
    }
    const knownCodes = new Set(parsedKnownRows.data.map((row) => row.code))
    const unknownCodes = nutrientCodes.filter((code) => !knownCodes.has(code))
    if (unknownCodes.length > 0) {
      return err(
        new FoodMasterDomainError(
          'unknown_nutrient_code',
          `nutrient_code not registered in nutrient_definitions: ${unknownCodes.join(', ')}`,
          { unknown: unknownCodes },
        ),
      )
    }

    const foodMasterRows = await tx<Record<string, unknown>[]>`
      SELECT id FROM food_masters
      WHERE id = ${input.foodMasterId}
      FOR UPDATE
    `
    const parsedFoodMasterRows = z
      .array(foodMasterRowSchema)
      .safeParse(foodMasterRows)
    if (!parsedFoodMasterRows.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `food_masters query returned invalid rows: ${parsedFoodMasterRows.error.message}`,
        ),
      )
    }
    if (parsedFoodMasterRows.data.length === 0) {
      return err(
        new FoodMasterDomainError(
          'food_master_not_found',
          `food_master not found: ${input.foodMasterId}`,
          { foodMasterId: input.foodMasterId },
        ),
      )
    }

    const existingVersions = await tx<Record<string, unknown>[]>`
      SELECT id, is_current, serving_basis, net_content,
             effective_from::text AS effective_from
      FROM food_master_nutrition
      WHERE food_master_id = ${input.foodMasterId}
    `
    const parsedExistingVersions = z
      .array(nutritionVersionStateSchema)
      .safeParse(existingVersions)
    if (!parsedExistingVersions.success) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          `food_master_nutrition query returned invalid rows: ${parsedExistingVersions.error.message}`,
        ),
      )
    }
    if (parsedExistingVersions.data.length === 0) {
      return err(
        new FoodMasterDomainError(
          'nutrition_version_required',
          `food_master has no nutrition version: ${input.foodMasterId}`,
          { foodMasterId: input.foodMasterId },
        ),
      )
    }

    const correctedVersion =
      input.changeKind === 'correction'
        ? parsedExistingVersions.data.find(
            (version) => version.id === input.correctsVersionId,
          )
        : undefined
    if (input.changeKind === 'correction' && correctedVersion === undefined) {
      return err(
        new FoodMasterDomainError(
          'nutrition_version_not_found',
          `nutrition version not found for food_master ${input.foodMasterId}: ${input.correctsVersionId ?? ''}`,
          {
            foodMasterId: input.foodMasterId,
            nutritionVersionId: input.correctsVersionId,
          },
        ),
      )
    }

    if (
      normalized.sourceCompositionCode !== null &&
      input.source === 'composition_table_estimate'
    ) {
      const rawCompositionRows = await tx<Record<string, unknown>[]>`
        SELECT EXISTS (
          SELECT 1 FROM food_compositions
          WHERE code = ${normalized.sourceCompositionCode}
        ) AS exists
      `
      const compositionRows = z
        .array(z.object({ exists: z.boolean() }))
        .safeParse(rawCompositionRows)
      if (!compositionRows.success) {
        return err(
          new FoodMasterDomainError(
            'persistence_failed',
            `food_compositions query returned invalid rows: ${compositionRows.error.message}`,
          ),
        )
      }
      if (compositionRows.data[0]?.exists !== true) {
        return err(
          new FoodMasterDomainError(
            'composition_not_found',
            `food_composition not found: ${normalized.sourceCompositionCode}`,
            { compositionCode: normalized.sourceCompositionCode },
          ),
        )
      }
    }

    const maxVersionRows = await tx<Record<string, unknown>[]>`
      SELECT COALESCE(MAX(version_no), 0)::int AS max_version_no
      FROM food_master_nutrition
      WHERE food_master_id = ${input.foodMasterId}
    `
    const parsedMaxVersionRows = z
      .array(maxVersionRowSchema)
      .safeParse(maxVersionRows)
    const maxVersion = parsedMaxVersionRows.success
      ? parsedMaxVersionRows.data[0]
      : undefined
    if (!parsedMaxVersionRows.success || maxVersion === undefined) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          parsedMaxVersionRows.success
            ? 'food_master_nutrition max version query returned no rows'
            : `food_master_nutrition max version query returned invalid rows: ${parsedMaxVersionRows.error.message}`,
        ),
      )
    }

    const becomesCurrent =
      input.changeKind === 'product_update' ||
      correctedVersion?.is_current === true
    if (becomesCurrent) {
      await tx`
        UPDATE food_master_nutrition SET is_current = false
        WHERE food_master_id = ${input.foodMasterId} AND is_current = true
      `
    }

    const versionNo = maxVersion.max_version_no + 1
    const reason =
      input.changeKind === 'correction' ? (input.reason?.trim() ?? null) : null
    const servingBasis = normalizeOptionalText(
      input.servingBasis === undefined
        ? correctedVersion?.serving_basis
        : input.servingBasis,
    )
    const netContent = normalizeOptionalText(
      input.netContent === undefined
        ? correctedVersion?.net_content
        : input.netContent,
    )
    const effectiveFrom =
      input.effectiveFrom === undefined
        ? (correctedVersion?.effective_from ?? null)
        : input.effectiveFrom
    const insertedRows = await tx<Record<string, unknown>[]>`
      INSERT INTO food_master_nutrition (
        food_master_id, version_no, is_current, change_kind,
        corrects_version_id, reason, is_estimated, source, source_url,
        source_composition_code, serving_basis, net_content, checked_on,
        effective_from, legacy_evidence
      )
      VALUES (
        ${input.foodMasterId}, ${versionNo}, ${becomesCurrent},
        ${input.changeKind},
        ${input.changeKind === 'correction' ? (input.correctsVersionId ?? null) : null},
        ${reason}, ${normalized.isEstimated}, ${normalized.source},
        ${normalized.sourceUrl}, ${normalized.sourceCompositionCode},
        ${servingBasis}, ${netContent},
        ${input.checkedOn ?? null}, ${effectiveFrom}, false
      )
      RETURNING id
    `
    const insertedVersion = z
      .array(z.object({ id: z.string() }))
      .safeParse(insertedRows)
    const versionId = insertedVersion.success
      ? insertedVersion.data[0]?.id
      : undefined
    if (versionId === undefined) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          'failed to insert food_master_nutrition row',
        ),
      )
    }

    const nutrientRows = nutrientCodes.map((code) => ({
      nutrition_version_id: versionId,
      nutrient_code: code,
      value: String(normalized.nutrition[code]),
    }))
    await tx`
      INSERT INTO food_master_nutrients
      ${tx(nutrientRows, 'nutrition_version_id', 'nutrient_code', 'value')}
    `

    return ok({
      id: versionId,
      foodMasterId: input.foodMasterId,
      versionNo,
      changeKind: input.changeKind,
      correctsVersionId:
        input.changeKind === 'correction'
          ? (input.correctsVersionId ?? null)
          : null,
      isCurrent: becomesCurrent,
      servingBasis,
      netContent,
      nutrition: normalized.nutrition,
      source: normalized.source,
      sourceUrl: normalized.sourceUrl,
      sourceCompositionCode: normalized.sourceCompositionCode,
      isEstimated: normalized.isEstimated,
      checkedOn: input.checkedOn ?? null,
      effectiveFrom,
      reason,
      mealLogCount: 0,
    })
  }

  const add = (
    input: AddFoodMasterNutritionVersionInput,
  ): ResultAsync<FoodMasterNutritionVersion, FoodMasterDomainError> => {
    const changeResult = validateChange(input)
    if (changeResult.isErr()) return errAsync(changeResult.error)
    const normalizedResult = normalizeAndValidateNutrition(input)
    if (normalizedResult.isErr()) return errAsync(normalizedResult.error)

    const settle = wrapInTransaction
      ? sql.begin((tx) => addInTx(tx, input, normalizedResult.value))
      : runInSavepoint(sql, generateId, (tx) =>
          addInTx(tx, input, normalizedResult.value),
        )
    return ResultAsync.fromPromise(settle, toPersistenceError).andThen(
      (result) => result,
    )
  }

  const list = (
    foodMasterId: string,
  ): ResultAsync<
    ReadonlyArray<FoodMasterNutritionVersion>,
    FoodMasterDomainError
  > =>
    ResultAsync.fromPromise(
      (async () => {
        const foodMasterRows = await sql<Record<string, unknown>[]>`
          SELECT id FROM food_masters WHERE id = ${foodMasterId}
        `
        const parsedFoodMasterRows = z
          .array(foodMasterRowSchema)
          .safeParse(foodMasterRows)
        if (!parsedFoodMasterRows.success) {
          return err(
            new FoodMasterDomainError(
              'persistence_failed',
              `food_masters query returned invalid rows: ${parsedFoodMasterRows.error.message}`,
            ),
          )
        }
        if (parsedFoodMasterRows.data.length === 0) {
          return err(
            new FoodMasterDomainError(
              'food_master_not_found',
              `food_master not found: ${foodMasterId}`,
              { foodMasterId },
            ),
          )
        }

        const rawRows = await sql<Record<string, unknown>[]>`
          SELECT version.id, version.food_master_id, version.version_no,
                 version.change_kind, version.corrects_version_id,
                 version.is_current, version.serving_basis, version.net_content,
                 COALESCE((
                   SELECT jsonb_object_agg(nutrient.nutrient_code, nutrient.value)
                   FROM food_master_nutrients AS nutrient
                   WHERE nutrient.nutrition_version_id = version.id
                 ), '{}'::jsonb) AS nutrition,
                 version.source, version.source_url,
                 version.source_composition_code, version.is_estimated,
                 version.checked_on::text AS checked_on,
                 version.effective_from::text AS effective_from,
                 version.reason,
                 (SELECT count(*)::int FROM meal_logs AS meal_log
                  WHERE meal_log.nutrition_version_id = version.id) AS meal_log_count
          FROM food_master_nutrition AS version
          WHERE version.food_master_id = ${foodMasterId}
          ORDER BY version.version_no
        `
        const parsedRows = z.array(nutritionVersionRowSchema).safeParse(rawRows)
        if (!parsedRows.success) {
          return err(
            new FoodMasterDomainError(
              'persistence_failed',
              `food_master_nutrition query returned invalid rows: ${parsedRows.error.message}`,
            ),
          )
        }
        return ok(parsedRows.data.map(toVersion))
      })(),
      toPersistenceError,
    ).andThen((result) => result)

  return { add, list }
}
