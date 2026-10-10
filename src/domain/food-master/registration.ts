import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'

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
} from '#domain/food-master/types'
import {
  hasDuplicateAfterTrim,
  INVALID_SOURCE_COMBINATION_MESSAGE,
  isEmptyNutrition,
  isInvalidSourceCombination,
  type SourceEvidenceViolation,
  validateSourceEvidence,
} from '#domain/food-master/validation'

const FOOD_MASTERS_NAME_CONSTRAINT = 'food_masters_name_key'
const FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT = 'food_master_aliases_alias_key'

interface NormalizedInput {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl: string | null
  readonly sourceCompositionCode: string | null
}

const SOURCE_EVIDENCE_VIOLATION_MESSAGE: Record<
  SourceEvidenceViolation,
  string
> = {
  missing_source_url: "source='web_search' requires sourceUrl",
  unexpected_source_url: "sourceUrl must not be set unless source='web_search'",
  missing_composition_code:
    "source='composition_table_estimate' requires sourceCompositionCode",
  unexpected_composition_code:
    "sourceCompositionCode must not be set unless source='composition_table_estimate'",
}

const normalizeAndValidate = (
  input: RegisterFoodMasterInput,
): Result<NormalizedInput, FoodMasterDomainError> => {
  const name = input.name.trim()
  if (name === '') {
    return err(
      new FoodMasterDomainError('empty_name', 'name must not be empty'),
    )
  }
  if (isInvalidSourceCombination(input.source, input.isEstimated)) {
    return err(
      new FoodMasterDomainError(
        'invalid_source_combination',
        // isInvalidSourceCombination's other branch (composition_table_estimate
        // + isEstimated=false) needs its own message — INVALID_SOURCE_COMBINATION_MESSAGE
        // is specific to the web_search case and would misdescribe that one.
        input.source === 'web_search'
          ? INVALID_SOURCE_COMBINATION_MESSAGE
          : "source='composition_table_estimate' requires is_estimated=true",
        { source: input.source, isEstimated: input.isEstimated },
      ),
    )
  }
  const sourceUrl = input.sourceUrl ?? null
  const sourceCompositionCode = input.sourceCompositionCode ?? null
  const evidenceViolation = validateSourceEvidence({
    source: input.source,
    sourceUrl,
    sourceCompositionCode,
  })
  if (evidenceViolation !== null) {
    return err(
      new FoodMasterDomainError(
        evidenceViolation,
        SOURCE_EVIDENCE_VIOLATION_MESSAGE[evidenceViolation],
        { source: input.source, sourceUrl, sourceCompositionCode },
      ),
    )
  }
  if (isEmptyNutrition(input.nutrition)) {
    return err(
      new FoodMasterDomainError(
        'empty_nutrition',
        'nutrition must include at least one nutrient value',
      ),
    )
  }
  for (const [code, value] of Object.entries(input.nutrition)) {
    if (!Number.isFinite(value) || value < 0) {
      return err(
        new FoodMasterDomainError(
          'negative_nutrient_value',
          `nutrient value must be a non-negative finite number (code=${code}, value=${String(value)})`,
          { code, value },
        ),
      )
    }
  }
  const aliases = (input.aliases ?? []).map((a) => a.trim())
  if (aliases.some((a) => a === '')) {
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
  return ok({
    name,
    aliases,
    nutrition: input.nutrition,
    source: input.source,
    isEstimated: input.isEstimated,
    sourceUrl,
    sourceCompositionCode,
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
): ((
  input: RegisterFoodMasterInput,
) => ResultAsync<FoodMaster, FoodMasterDomainError>) => {
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

    await tx`
      INSERT INTO food_master_nutrition (
        food_master_id, is_estimated, source, source_url, source_composition_code
      )
      VALUES (
        ${id},
        ${normalized.isEstimated},
        ${normalized.source},
        ${normalized.sourceUrl},
        ${normalized.sourceCompositionCode}
      )
    `

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
        food_master_id: id,
        nutrient_code: code,
        value: String(normalized.nutrition[code]),
      }))
      await tx`INSERT INTO food_master_nutrients ${tx(nutrientRows, 'food_master_id', 'nutrient_code', 'value')}`
    }

    return ok({
      id: inserted.id,
      name: inserted.name,
      aliases: normalized.aliases,
      isEstimated: normalized.isEstimated,
      nutritionStatus: normalized.isEstimated ? 'estimated' : 'confirmed',
      source: normalized.source,
      sourceUrl: normalized.sourceUrl,
      sourceCompositionCode: normalized.sourceCompositionCode,
      nutrition: normalized.nutrition,
      createdAt: inserted.created_at,
    })
  }

  return (input) => {
    const normalizedResult = normalizeAndValidate(input)
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
}
