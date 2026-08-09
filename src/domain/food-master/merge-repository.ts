import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import { toNutritionMap, type TxSql } from '#domain/food-master/rows'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  FoodMasterId,
  FoodMasterUnitDefinition,
  MergeFoodMasterResult,
} from '#domain/food-master/types'

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

const toMergeError = (caughtErr: unknown): FoodMasterDomainError =>
  new FoodMasterDomainError(
    'persistence_failed',
    errorMessage(caughtErr),
    {},
    caughtErr,
  )

const notFoundError = (foodMasterId: FoodMasterId): FoodMasterDomainError =>
  new FoodMasterDomainError(
    'food_master_not_found',
    `food_master not found: ${foodMasterId}`,
    { foodMasterId },
  )

const foodMasterRowSchema = z.object({ id: z.string(), name: z.string() })
const aliasRowSchema = z.object({ alias: z.string() })
const idRowSchema = z.object({ id: z.string() })
const existsRowSchema = z.object({ conflicts: z.boolean() })
const unitRowSchema = z.object({
  unit: z.string(),
  grams_per_unit: z.string(),
})
const unitConflictRowSchema = unitRowSchema.extend({
  conflicts: z.boolean(),
})
const nutrientRowSchema = z.object({
  nutrient_code: z.string(),
  value: z.string(),
})
const countRowSchema = z.object({ count: z.number() })

type UnitRow = z.infer<typeof unitRowSchema>

const toUnitDefinition = (row: UnitRow): FoodMasterUnitDefinition => ({
  unit: row.unit,
  gramsPerUnit: Number(row.grams_per_unit),
})

// Every raw-SQL query result below goes through this before use — Postgres
// is a process other than this one, and `sql<T[]>`'s type parameter alone
// doesn't check anything at runtime (see CLAUDE.md's zod-at-I/O-boundaries
// rule and the same pattern in repository.ts's findSimilarNames).
const parseRows = <T>(
  schema: z.ZodType<T>,
  rows: ReadonlyArray<unknown>,
): Result<T[], FoodMasterDomainError> => {
  const parsed = z.array(schema).safeParse(rows)
  if (!parsed.success) {
    return err(
      new FoodMasterDomainError(
        'persistence_failed',
        `merge query returned an invalid row: ${parsed.error.message}`,
      ),
    )
  }
  return ok(parsed.data)
}

// SELECT-only counterpart of applyMerge below, used for dry_run: predicts
// the same result shape an apply would produce without writing anything.
// Not wrapped in a transaction — a plain SELECT preview tolerates the same
// races the rest of this single-conversation-at-a-time bot already accepts
// elsewhere (e.g. findById's parallel selects).
const planMerge = async (
  sql: Sql,
  survivorId: FoodMasterId,
  loserId: FoodMasterId,
): Promise<Result<MergeFoodMasterResult, FoodMasterDomainError>> => {
  const bothRows = parseRows(
    foodMasterRowSchema,
    await sql<Record<string, unknown>[]>`
      SELECT id, name FROM food_masters WHERE id IN (${survivorId}, ${loserId})
    `,
  )
  if (bothRows.isErr()) return err(bothRows.error)
  const survivor = bothRows.value.find((r) => r.id === survivorId)
  const loser = bothRows.value.find((r) => r.id === loserId)
  if (survivor === undefined) return err(notFoundError(survivorId))
  if (loser === undefined) return err(notFoundError(loserId))

  const [
    movedAliasRowsRaw,
    nameConflictRowsRaw,
    unitRowsRaw,
    discardedNutritionRowsRaw,
    mealLogCountRowsRaw,
  ] = await Promise.all([
    sql<Record<string, unknown>[]>`
      SELECT alias FROM food_master_aliases WHERE food_master_id = ${loserId}
    `,
    sql<Record<string, unknown>[]>`
      SELECT EXISTS(
        SELECT 1 FROM food_master_aliases WHERE alias = ${loser.name}
      ) AS conflicts
    `,
    sql<Record<string, unknown>[]>`
      SELECT loser_unit.unit, loser_unit.grams_per_unit,
             EXISTS(
               SELECT 1 FROM food_master_units survivor_unit
               WHERE survivor_unit.food_master_id = ${survivorId}
                 AND survivor_unit.unit = loser_unit.unit
             ) AS conflicts
      FROM food_master_units loser_unit
      WHERE loser_unit.food_master_id = ${loserId}
    `,
    sql<Record<string, unknown>[]>`
      SELECT nutrient_code, value
      FROM food_master_nutrients
      WHERE food_master_id = ${loserId}
    `,
    sql<Record<string, unknown>[]>`
      SELECT count(*)::int AS count FROM meal_logs WHERE food_master_id = ${loserId}
    `,
  ])

  const movedAliasRows = parseRows(aliasRowSchema, movedAliasRowsRaw)
  if (movedAliasRows.isErr()) return err(movedAliasRows.error)
  const nameConflictRows = parseRows(existsRowSchema, nameConflictRowsRaw)
  if (nameConflictRows.isErr()) return err(nameConflictRows.error)
  const unitRows = parseRows(unitConflictRowSchema, unitRowsRaw)
  if (unitRows.isErr()) return err(unitRows.error)
  const discardedNutritionRows = parseRows(
    nutrientRowSchema,
    discardedNutritionRowsRaw,
  )
  if (discardedNutritionRows.isErr()) return err(discardedNutritionRows.error)
  const mealLogCountRows = parseRows(countRowSchema, mealLogCountRowsRaw)
  if (mealLogCountRows.isErr()) return err(mealLogCountRows.error)

  return ok({
    survivorId,
    loserId,
    applied: false,
    movedAliases: movedAliasRows.value.map((r) => r.alias),
    nameMovedAsAlias:
      nameConflictRows.value[0]?.conflicts === true ? null : loser.name,
    movedUnits: unitRows.value
      .filter((r) => !r.conflicts)
      .map(toUnitDefinition),
    discardedUnits: unitRows.value
      .filter((r) => r.conflicts)
      .map(toUnitDefinition),
    discardedNutrition: toNutritionMap(discardedNutritionRows.value),
    movedMealLogCount: mealLogCountRows.value[0]?.count ?? 0,
  })
}

// Writing counterpart of planMerge above, run inside a transaction. Every
// business-rule err() below is returned before any write happens, so a
// resolved Err never leaves partial writes for sql.begin to commit.
const applyMerge = async (
  tx: Sql | TxSql,
  generateId: IdGenerator,
  survivorId: FoodMasterId,
  loserId: FoodMasterId,
): Promise<Result<MergeFoodMasterResult, FoodMasterDomainError>> => {
  // Locked as a single IN (...) query, independent of which id is survivor
  // and which is loser: two concurrent merges of the same pair passed in
  // opposite roles (survivor/loser swapped) would otherwise lock the two
  // rows in opposite orders and deadlock.
  const bothRows = parseRows(
    foodMasterRowSchema,
    await tx<Record<string, unknown>[]>`
      SELECT id, name FROM food_masters
      WHERE id IN (${survivorId}, ${loserId})
      FOR UPDATE
    `,
  )
  if (bothRows.isErr()) return err(bothRows.error)
  const survivor = bothRows.value.find((r) => r.id === survivorId)
  const loser = bothRows.value.find((r) => r.id === loserId)
  if (survivor === undefined) return err(notFoundError(survivorId))
  if (loser === undefined) return err(notFoundError(loserId))

  // Read before the DELETE below cascades these rows away.
  const discardedNutritionRows = parseRows(
    nutrientRowSchema,
    await tx<Record<string, unknown>[]>`
      SELECT nutrient_code, value
      FROM food_master_nutrients
      WHERE food_master_id = ${loserId}
    `,
  )
  if (discardedNutritionRows.isErr()) return err(discardedNutritionRows.error)

  const movedAliasRows = parseRows(
    aliasRowSchema,
    await tx<Record<string, unknown>[]>`
      UPDATE food_master_aliases SET food_master_id = ${survivorId}
      WHERE food_master_id = ${loserId}
      RETURNING alias
    `,
  )
  if (movedAliasRows.isErr()) return err(movedAliasRows.error)

  // alias is globally unique, so the loser's own aliases (just moved above)
  // never collide on survivor — only the loser's *name*, inserted fresh as
  // a new alias row, can already exist as someone else's alias.
  const nameAliasRows = parseRows(
    idRowSchema,
    await tx<Record<string, unknown>[]>`
      INSERT INTO food_master_aliases (id, food_master_id, alias)
      VALUES (${generateId('fma')}, ${survivorId}, ${loser.name})
      ON CONFLICT (alias) DO NOTHING
      RETURNING id
    `,
  )
  if (nameAliasRows.isErr()) return err(nameAliasRows.error)

  const movedUnitRows = parseRows(
    unitRowSchema,
    await tx<Record<string, unknown>[]>`
      UPDATE food_master_units AS loser_unit
      SET food_master_id = ${survivorId}
      WHERE loser_unit.food_master_id = ${loserId}
        AND NOT EXISTS (
          SELECT 1 FROM food_master_units survivor_unit
          WHERE survivor_unit.food_master_id = ${survivorId}
            AND survivor_unit.unit = loser_unit.unit
        )
      RETURNING unit, grams_per_unit
    `,
  )
  if (movedUnitRows.isErr()) return err(movedUnitRows.error)
  // Whatever is still under loserId after the move above conflicted with an
  // already-defined survivor unit and is about to be cascade-deleted.
  const discardedUnitRows = parseRows(
    unitRowSchema,
    await tx<Record<string, unknown>[]>`
      SELECT unit, grams_per_unit
      FROM food_master_units
      WHERE food_master_id = ${loserId}
    `,
  )
  if (discardedUnitRows.isErr()) return err(discardedUnitRows.error)

  const movedMealLogRows = parseRows(
    idRowSchema,
    await tx<Record<string, unknown>[]>`
      UPDATE meal_logs SET food_master_id = ${survivorId}
      WHERE food_master_id = ${loserId}
      RETURNING id
    `,
  )
  if (movedMealLogRows.isErr()) return err(movedMealLogRows.error)

  // meal_logs is fully repointed above, so this DELETE never trips the
  // meal_logs FK's ON DELETE RESTRICT; food_master_aliases/_units/_nutrients
  // cascade away whatever was deliberately left under loserId.
  await tx`DELETE FROM food_masters WHERE id = ${loserId}`

  return ok({
    survivorId,
    loserId,
    applied: true,
    movedAliases: movedAliasRows.value.map((r) => r.alias),
    nameMovedAsAlias: nameAliasRows.value.length > 0 ? loser.name : null,
    movedUnits: movedUnitRows.value.map(toUnitDefinition),
    discardedUnits: discardedUnitRows.value.map(toUnitDefinition),
    discardedNutrition: toNutritionMap(discardedNutritionRows.value),
    movedMealLogCount: movedMealLogRows.value.length,
  })
}

export interface MergeFoodMastersOptions {
  readonly dryRun: boolean
  // Set false when `sql` is already inside an outer transaction (per-test
  // transactions in unit tests) — postgres-js rejects a nested BEGIN.
  readonly wrapInTransaction: boolean
}

export const mergeFoodMasters = (
  sql: Sql,
  generateId: IdGenerator,
  survivorId: FoodMasterId,
  loserId: FoodMasterId,
  { dryRun, wrapInTransaction }: MergeFoodMastersOptions,
): ResultAsync<MergeFoodMasterResult, FoodMasterDomainError> => {
  if (survivorId === loserId) {
    return errAsync(
      new FoodMasterDomainError(
        'same_food_master',
        'survivor_food_master_id and loser_food_master_id must differ',
        { foodMasterId: survivorId },
      ),
    )
  }

  if (dryRun) {
    return ResultAsync.fromPromise(
      planMerge(sql, survivorId, loserId),
      toMergeError,
    ).andThen((result) => result)
  }

  const settle: Promise<Result<MergeFoodMasterResult, FoodMasterDomainError>> =
    wrapInTransaction
      ? sql.begin((tx) => applyMerge(tx, generateId, survivorId, loserId))
      : runInSavepoint(sql, generateId, (tx) =>
          applyMerge(tx, generateId, survivorId, loserId),
        )

  return ResultAsync.fromPromise(settle, toMergeError).andThen(
    (result) => result,
  )
}
