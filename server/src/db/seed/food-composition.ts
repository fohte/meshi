import { readFile } from 'node:fs/promises'

import { err, ok, okAsync, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { SqlOrTx } from '#db/index'
import {
  type NutrientDefinitionSeed,
  upsertNutrientDefinitions,
} from '#db/seed/nutrient-definitions'

const foodCompositionRowSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  nutrients: z.record(z.string().min(1), z.number().nonnegative()),
})

const foodCompositionDatasetSchema = z.array(foodCompositionRowSchema)

export type FoodCompositionRow = z.infer<typeof foodCompositionRowSchema>

// food_composition_nutrients uses 3 columns per row; at the Postgres prepared-
// statement limit of 65535 parameters that caps a single multi-row insert at
// 21845 rows. Chunk well below that to leave room for other params in the same
// statement.
const DEFAULT_BATCH_SIZE = 1000

export interface LoadFoodCompositionOptions {
  readonly extraNutrientDefinitions?: ReadonlyArray<NutrientDefinitionSeed>
  readonly batchSize?: number
}

export interface LoadFoodCompositionResult {
  readonly foodCount: number
  readonly nutrientRowCount: number
}

export class FoodCompositionLoadError extends Error {
  constructor(
    message: string,
    public readonly missingNutrientCodes?: ReadonlyArray<string>,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodCompositionLoadError'
  }
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

export const parseFoodCompositionDataset = (
  raw: unknown,
): Result<ReadonlyArray<FoodCompositionRow>, FoodCompositionLoadError> => {
  const parsed = foodCompositionDatasetSchema.safeParse(raw)
  if (!parsed.success) {
    return err(
      new FoodCompositionLoadError(
        `invalid food composition dataset: ${parsed.error.message}`,
      ),
    )
  }
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const row of parsed.data) {
    if (seen.has(row.code)) duplicates.add(row.code)
    seen.add(row.code)
  }
  if (duplicates.size > 0) {
    return err(
      new FoodCompositionLoadError(
        `duplicate food composition codes in dataset: ${[...duplicates].sort().join(', ')}`,
      ),
    )
  }
  return ok(parsed.data)
}

export const loadFoodCompositionDatasetFromFile = (
  path: string,
): ResultAsync<ReadonlyArray<FoodCompositionRow>, FoodCompositionLoadError> =>
  ResultAsync.fromPromise(
    (async (): Promise<unknown> => JSON.parse(await readFile(path, 'utf8')))(),
    (caughtErr): FoodCompositionLoadError =>
      new FoodCompositionLoadError(
        `failed to read food composition dataset file: ${errorMessage(caughtErr)}`,
        undefined,
        caughtErr,
      ),
  ).andThen((raw) => parseFoodCompositionDataset(raw))

// Runs every write directly on the passed `tx`. Production callers wrap with
// `sql.begin` for atomicity; tests pass a per-test reserved tx that rolls
// back in afterEach. Returns a Result rather than rejecting on a domain-level
// failure so a caller composing this with other steps can branch on it —
// `loadFoodComposition` below re-derives a rejection from an Err result when
// it needs `sql.begin` to roll back a partial write.
const loadFoodCompositionInTx = async (
  tx: SqlOrTx,
  rows: ReadonlyArray<FoodCompositionRow>,
  options: LoadFoodCompositionOptions,
): Promise<Result<LoadFoodCompositionResult, FoodCompositionLoadError>> => {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    return err(
      new FoodCompositionLoadError(
        `batchSize must be a positive integer (got: ${String(batchSize)})`,
      ),
    )
  }

  if (
    options.extraNutrientDefinitions &&
    options.extraNutrientDefinitions.length > 0
  ) {
    await upsertNutrientDefinitions(tx, options.extraNutrientDefinitions)
  }

  const usedNutrientCodes = new Set<string>()
  for (const row of rows) {
    for (const code of Object.keys(row.nutrients)) {
      usedNutrientCodes.add(code)
    }
  }

  if (usedNutrientCodes.size > 0) {
    const existing = await tx<{ code: string }[]>`
      SELECT code FROM nutrient_definitions
      WHERE code = ANY(${tx.array([...usedNutrientCodes])})
    `
    const known = new Set(existing.map((r) => r.code))
    const missing = [...usedNutrientCodes].filter((c) => !known.has(c)).sort()
    if (missing.length > 0) {
      return err(
        new FoodCompositionLoadError(
          `unknown nutrient codes: ${missing.join(', ')}. ` +
            `Pass them via extraNutrientDefinitions or add to NUTRIENT_DEFINITION_SEEDS.`,
          missing,
        ),
      )
    }
  }

  const foodRows = rows.map((r) => ({ code: r.code, name: r.name }))
  for (let i = 0; i < foodRows.length; i += batchSize) {
    const batch = foodRows.slice(i, i + batchSize)
    await tx`
      INSERT INTO food_compositions ${tx(batch)}
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
    `
  }

  const codes = rows.map((r) => r.code)
  await tx`
    DELETE FROM food_composition_nutrients
    WHERE food_composition_code = ANY(${tx.array(codes)})
  `

  const nutrientRows = rows.flatMap((row) =>
    Object.entries(row.nutrients).map(([code, value]) => ({
      food_composition_code: row.code,
      nutrient_code: code,
      value: String(value),
    })),
  )

  for (let i = 0; i < nutrientRows.length; i += batchSize) {
    const batch = nutrientRows.slice(i, i + batchSize)
    await tx`INSERT INTO food_composition_nutrients ${tx(batch)}`
  }

  return ok({
    foodCount: rows.length,
    nutrientRowCount: nutrientRows.length,
  })
}

// `sql.begin`'s rollback-on-failure only triggers when the callback's promise
// rejects, so an Err result (a normal resolution, not a rejection) has to be
// turned back into a rejection here to trigger it — mirroring how
// src/domain/food-master/repository.ts's runInSavepoint re-propagates a
// caught error via Promise.reject rather than a throw statement.
const settleInTx = async (
  tx: SqlOrTx,
  rows: ReadonlyArray<FoodCompositionRow>,
  options: LoadFoodCompositionOptions,
): Promise<LoadFoodCompositionResult> => {
  const result = await loadFoodCompositionInTx(tx, rows, options)
  if (result.isOk()) return result.value
  return Promise.reject(result.error)
}

export const loadFoodComposition = (
  sql: SqlOrTx,
  rows: ReadonlyArray<FoodCompositionRow>,
  options: LoadFoodCompositionOptions = {},
): ResultAsync<LoadFoodCompositionResult, FoodCompositionLoadError> => {
  if (rows.length === 0) {
    return okAsync({ foodCount: 0, nutrientRowCount: 0 })
  }
  // Only open a new transaction on a top-level Sql (which has `.begin`).
  // A ReservedSql / TransactionSql passed by the caller doesn't have it,
  // and the caller is expected to manage the surrounding transaction.
  const settle =
    'begin' in sql && typeof sql.begin === 'function'
      ? sql.begin((tx) => settleInTx(tx, rows, options))
      : settleInTx(sql, rows, options)

  return ResultAsync.fromPromise(
    settle,
    (caughtErr): FoodCompositionLoadError =>
      caughtErr instanceof FoodCompositionLoadError
        ? caughtErr
        : new FoodCompositionLoadError(
            `failed to load food composition dataset: ${errorMessage(caughtErr)}`,
            undefined,
            caughtErr,
          ),
  )
}
