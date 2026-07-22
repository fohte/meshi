import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import type postgres from 'postgres'

import type { Sql } from '@/db'
import { FoodMasterDomainError } from '@/domain/food-master/errors'
import { defaultIdGenerator, type IdGenerator } from '@/domain/food-master/id'
import type {
  FoodMaster,
  FoodMasterId,
  FoodSource,
  NutritionMap,
  RegisterFoodMasterInput,
} from '@/domain/food-master/types'

export interface FoodMasterRepository {
  register(
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  findById(
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError>
}

export interface CreateRepositoryOptions {
  readonly generateId?: IdGenerator
  // Wrap `register`'s writes in `sql.begin` (default) so a single registration
  // is atomic at the boundary. Set false when the caller already runs inside a
  // transaction (per-test transactions in unit tests) — postgres-js rejects a
  // nested BEGIN, and the outer transaction already provides atomicity.
  readonly wrapInTransaction?: boolean
}

const PG_UNIQUE_VIOLATION = '23505'

const FOOD_MASTERS_NAME_CONSTRAINT = 'food_masters_name_key'
const FOOD_MASTER_ALIASES_ALIAS_CONSTRAINT = 'food_master_aliases_alias_key'

interface PgErrorShape {
  readonly code?: string
  readonly constraint_name?: string
}

const findPostgresError = (err: unknown): PgErrorShape | undefined => {
  let current: unknown = err
  while (typeof current === 'object' && current !== null) {
    if ('code' in current && typeof current.code === 'string') {
      const shape: PgErrorShape = { code: current.code }
      if (
        'constraint_name' in current &&
        typeof current.constraint_name === 'string'
      ) {
        return { ...shape, constraint_name: current.constraint_name }
      }
      return shape
    }
    if ('cause' in current) {
      current = current.cause
      continue
    }
    return undefined
  }
  return undefined
}

const isUniqueViolation = (err: unknown): boolean =>
  findPostgresError(err)?.code === PG_UNIQUE_VIOLATION

const getConstraintName = (err: unknown): string | undefined =>
  findPostgresError(err)?.constraint_name

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

interface NormalizedInput {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl: string | null
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
  if (input.isEstimated && input.source === 'web_search') {
    return err(
      new FoodMasterDomainError(
        'invalid_source_combination',
        "is_estimated=true must not be combined with source='web_search'",
        { source: input.source, isEstimated: input.isEstimated },
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
  if (new Set(aliases).size !== aliases.length) {
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
    sourceUrl: input.sourceUrl ?? null,
  })
}

const toNutritionMap = (
  rows: ReadonlyArray<{ nutrient_code: string; value: string }>,
): NutritionMap => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.nutrient_code] = Number(row.value)
  }
  return map
}

type TxSql = postgres.TransactionSql<Record<string, never>>

interface FoodMasterRow {
  readonly id: string
  readonly name: string
  readonly is_estimated: boolean
  readonly source: FoodSource
  readonly source_url: string | null
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

const runInSavepoint = (
  sql: Sql,
  generateId: IdGenerator,
  fn: (tx: Sql) => Promise<Result<FoodMaster, FoodMasterDomainError>>,
): Promise<Result<FoodMaster, FoodMasterDomainError>> => {
  const savepoint = `fm_register_${generateId('sp').replace(/[^A-Za-z0-9_]/g, '_')}`
  return sql.unsafe(`SAVEPOINT ${savepoint}`).then(() =>
    fn(sql)
      .then((result) =>
        sql.unsafe(`RELEASE SAVEPOINT ${savepoint}`).then(() => result),
      )
      .catch((caughtErr: unknown) =>
        sql.unsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`).then(() =>
          // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- re-propagating the original rejection reason (a real Error from postgres.js) without a throw statement; this file may not use throw/try.
          Promise.reject(caughtErr),
        ),
      ),
  )
}

export const createFoodMasterRepository = (
  sql: Sql,
  options: CreateRepositoryOptions = {},
): FoodMasterRepository => {
  const generateId = options.generateId ?? defaultIdGenerator
  const wrapInTransaction = options.wrapInTransaction ?? true

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

    const [inserted] = await tx<FoodMasterRow[]>`
      INSERT INTO food_masters (id, name, is_estimated, source, source_url)
      VALUES (${id}, ${normalized.name}, ${normalized.isEstimated}, ${normalized.source}, ${normalized.sourceUrl})
      RETURNING id, name, is_estimated, source, source_url, created_at
    `
    if (inserted === undefined) {
      return err(
        new FoodMasterDomainError(
          'persistence_failed',
          'failed to insert food_master row',
        ),
      )
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
      isEstimated: inserted.is_estimated,
      source: inserted.source,
      sourceUrl: inserted.source_url,
      nutrition: normalized.nutrition,
      createdAt: inserted.created_at,
    })
  }

  const register = (
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError> => {
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

  const findById = (
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError> =>
    ResultAsync.fromPromise(
      (async () => {
        const rows = await sql<FoodMasterRow[]>`
          SELECT id, name, is_estimated, source, source_url, created_at
          FROM food_masters
          WHERE id = ${id}
        `
        const row = rows[0]
        if (row === undefined) return null

        const [aliasRows, nutrientRows] = await Promise.all([
          sql<{ alias: string }[]>`
            SELECT alias FROM food_master_aliases WHERE food_master_id = ${id}
          `,
          sql<{ nutrient_code: string; value: string }[]>`
            SELECT nutrient_code, value
            FROM food_master_nutrients
            WHERE food_master_id = ${id}
          `,
        ])

        return {
          id: row.id,
          name: row.name,
          aliases: aliasRows.map((r) => r.alias),
          isEstimated: row.is_estimated,
          source: row.source,
          sourceUrl: row.source_url,
          nutrition: toNutritionMap(nutrientRows),
          createdAt: row.created_at,
        }
      })(),
      (caughtErr) =>
        new FoodMasterDomainError(
          'persistence_failed',
          errorMessage(caughtErr),
          {},
          caughtErr,
        ),
    )

  return { register, findById }
}
