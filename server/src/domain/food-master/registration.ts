import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { getConstraintName, isUniqueViolation } from '#db/pg-error'
import { errorMessage, FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import type { TxSql } from '#domain/food-master/rows'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  FoodMaster,
  FoodSource,
  NutritionMap,
  RegisterFoodMasterInput,
  RegisterFoodMasterWithoutNutritionInput,
} from '#domain/food-master/types'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'
import {
  hasDuplicateAfterTrim,
  normalizeAndValidateNutrition,
} from '#domain/food-master/validation'

const FOOD_MASTERS_NAME_CONSTRAINT = 'food_masters_name_key'
const FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT = 'food_master_aliases_alias_key'

const nutritionVersionRowSchema = z.object({ id: z.string() })

interface NormalizedInput {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource | null
  readonly isEstimated: boolean
  readonly sourceUrl: string | null
  readonly sourceCompositionCode: string | null
  readonly hasNutritionRecord: boolean
}

const normalizeFoodMasterName = (
  rawName: string,
): Result<string, FoodMasterDomainError> => {
  const name = rawName.trim()
  if (name === '') {
    return err(
      new FoodMasterDomainError('empty_name', 'name must not be empty'),
    )
  }
  return ok(name)
}

const normalizeFoodMasterAliases = (
  rawAliases: ReadonlyArray<string> | undefined,
): Result<ReadonlyArray<string>, FoodMasterDomainError> => {
  const aliases = (rawAliases ?? []).map((alias) => alias.trim())
  if (aliases.some((alias) => alias === '')) {
    return err(
      new FoodMasterDomainError(
        'empty_alias',
        'alias must not be empty string',
      ),
    )
  }
  if (hasDuplicateAfterTrim(aliases)) {
    return err(
      new FoodMasterDomainError(
        'duplicate_alias_in_input',
        'aliases must not contain duplicates within the same input',
        { aliases },
      ),
    )
  }
  return ok(aliases)
}

const normalizeAndValidate = (
  input: RegisterFoodMasterInput,
): Result<NormalizedInput, FoodMasterDomainError> => {
  const normalizedName = normalizeFoodMasterName(input.name)
  if (normalizedName.isErr()) return err(normalizedName.error)
  const nutritionResult = normalizeAndValidateNutrition(input)
  if (nutritionResult.isErr()) return err(nutritionResult.error)
  const normalizedAliases = normalizeFoodMasterAliases(input.aliases)
  if (normalizedAliases.isErr()) return err(normalizedAliases.error)
  return ok({
    name: normalizedName.value,
    aliases: normalizedAliases.value,
    ...nutritionResult.value,
    hasNutritionRecord: true,
  })
}

const normalizeWithoutNutrition = (
  input: RegisterFoodMasterWithoutNutritionInput,
): Result<NormalizedInput, FoodMasterDomainError> => {
  const normalizedName = normalizeFoodMasterName(input.name)
  if (normalizedName.isErr()) return err(normalizedName.error)
  const normalizedAliases = normalizeFoodMasterAliases(input.aliases)
  if (normalizedAliases.isErr()) return err(normalizedAliases.error)
  return ok({
    name: normalizedName.value,
    aliases: normalizedAliases.value,
    nutrition: {},
    source: null,
    isEstimated: false,
    sourceUrl: null,
    sourceCompositionCode: null,
    hasNutritionRecord: false,
  })
}

interface FoodMasterInsertRow {
  readonly id: string
  readonly name: string
  readonly created_at: Date
}

const toRegisterError = (
  caughtErr: unknown,
  normalized: NormalizedInput,
): FoodMasterDomainError => {
  if (isUniqueViolation(caughtErr)) {
    const constraint = getConstraintName(caughtErr)
    if (constraint === FOOD_MASTERS_NAME_CONSTRAINT) {
      return new FoodMasterDomainError(
        'duplicate_name',
        `food_master with name already exists: ${normalized.name}`,
        { name: normalized.name },
        caughtErr,
      )
    }
    if (constraint === FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT) {
      return new FoodMasterDomainError(
        'duplicate_alias',
        'one or more aliases already belong to another food_master',
        { aliases: normalized.aliases },
        caughtErr,
      )
    }
  }
  return new FoodMasterDomainError(
    'persistence_failed',
    errorMessage(caughtErr),
    {},
    caughtErr,
  )
}

export const createFoodMasterRegistrar = (
  sql: Sql,
  generateId: IdGenerator,
  wrapInTransaction: boolean,
): {
  readonly register: (
    input: RegisterFoodMasterInput,
  ) => ResultAsync<FoodMaster, FoodMasterDomainError>
  readonly registerWithoutNutrition: (
    input: RegisterFoodMasterWithoutNutritionInput,
  ) => ResultAsync<FoodMaster, FoodMasterDomainError>
} => {
  const registerInTx = async (
    tx: Sql | TxSql,
    normalized: NormalizedInput,
    nutrientCodes: ReadonlyArray<string>,
    id: string,
  ): Promise<Result<FoodMaster, FoodMasterDomainError>> => {
    if (nutrientCodes.length > 0) {
      const known = await tx<{ code: string }[]>`
        SELECT code FROM nutrient_definitions
        WHERE code IN ${tx([...nutrientCodes])}
      `
      const knownSet = new Set(known.map((r) => r.code))
      const unknown = nutrientCodes.filter((c) => !knownSet.has(c))
      if (unknown.length > 0) {
        return err(
          new FoodMasterDomainError(
            'unknown_nutrient_code',
            `nutrient_code not registered in nutrient_definitions: ${unknown.join(', ')}`,
            { unknown },
          ),
        )
      }
    }

    const [inserted] = await tx<FoodMasterInsertRow[]>`
      INSERT INTO food_masters (id, name)
      VALUES (${id}, ${normalized.name})
      RETURNING id, name, created_at
    `
    if (inserted === undefined) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          'failed to insert food_master row',
        ),
      )
    }

    let nutritionVersionId: string | null = null
    if (normalized.hasNutritionRecord) {
      const insertedVersion = await tx<Record<string, unknown>[]>`
        INSERT INTO food_master_nutrition (
          food_master_id, version_no, is_current, change_kind, is_estimated,
          source, source_url, source_composition_code
        )
        VALUES (
          ${id}, 1, true, 'initial', ${normalized.isEstimated},
          ${normalized.source}, ${normalized.sourceUrl},
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

    if (normalized.aliases.length > 0) {
      const aliasRows = normalized.aliases.map((alias) => ({
        id: generateId('fma'),
        food_master_id: id,
        alias,
      }))
      await tx`INSERT INTO food_master_aliases ${tx(aliasRows, 'id', 'food_master_id', 'alias')}`
    }

    if (nutrientCodes.length > 0) {
      const nutrientRows = nutrientCodes.map((code) => ({
        nutrition_version_id: nutritionVersionId,
        nutrient_code: code,
        value: String(normalized.nutrition[code]),
      }))
      await tx`INSERT INTO food_master_nutrients ${tx(nutrientRows, 'nutrition_version_id', 'nutrient_code', 'value')}`
    }

    return ok({
      id: inserted.id,
      name: inserted.name,
      aliases: normalized.aliases,
      isEstimated: normalized.isEstimated,
      nutritionStatus: normalized.hasNutritionRecord
        ? nutritionStatusFromIsEstimated(normalized.isEstimated)
        : 'unknown',
      source: normalized.source,
      sourceUrl: normalized.sourceUrl,
      sourceCompositionCode: normalized.sourceCompositionCode,
      nutrition: normalized.nutrition,
      createdAt: inserted.created_at,
    })
  }

  const registerNormalized = (
    normalizedResult: Result<NormalizedInput, FoodMasterDomainError>,
  ): ResultAsync<FoodMaster, FoodMasterDomainError> => {
    if (normalizedResult.isErr()) return errAsync(normalizedResult.error)
    const normalized = normalizedResult.value
    const nutrientCodes = Object.keys(normalized.nutrition)
    const id = generateId('fm')

    const settle: Promise<Result<FoodMaster, FoodMasterDomainError>> =
      wrapInTransaction
        ? sql.begin((tx) => registerInTx(tx, normalized, nutrientCodes, id))
        : runInSavepoint(sql, generateId, (tx) =>
            registerInTx(tx, normalized, nutrientCodes, id),
          )

    return ResultAsync.fromPromise(settle, (caughtErr) =>
      toRegisterError(caughtErr, normalized),
    ).andThen((result) => result)
  }

  return {
    register: (input) => registerNormalized(normalizeAndValidate(input)),
    registerWithoutNutrition: (input) =>
      registerNormalized(normalizeWithoutNutrition(input)),
  }
}
