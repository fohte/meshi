import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import type postgres from 'postgres'

import type { Sql } from '#db/index'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  FoodMasterId,
  FoodMasterUnitDefinition,
  MergeFoodMasterResult,
} from '#domain/food-master/types'

type TxSql = postgres.TransactionSql<Record<string, never>>

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

interface UnitRow {
  readonly unit: string
  readonly grams_per_unit: string
}

const toUnitDefinition = (row: UnitRow): FoodMasterUnitDefinition => ({
  unit: row.unit,
  gramsPerUnit: Number(row.grams_per_unit),
})

const toNutritionMap = (
  rows: ReadonlyArray<{ nutrient_code: string; value: string }>,
): Record<string, number> => {
  const map: Record<string, number> = {}
  for (const row of rows) {
    map[row.nutrient_code] = Number(row.value)
  }
  return map
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
  const [survivorRows, loserRows] = await Promise.all([
    sql<{ id: string }[]>`
      SELECT id FROM food_masters WHERE id = ${survivorId}
    `,
    sql<{ id: string; name: string }[]>`
      SELECT id, name FROM food_masters WHERE id = ${loserId}
    `,
  ])
  const survivor = survivorRows[0]
  const loser = loserRows[0]
  if (survivor === undefined) return err(notFoundError(survivorId))
  if (loser === undefined) return err(notFoundError(loserId))

  const [
    movedAliasRows,
    nameConflictRows,
    unitRows,
    discardedNutritionRows,
    mealLogCountRows,
  ] = await Promise.all([
    sql<{ alias: string }[]>`
      SELECT alias FROM food_master_aliases WHERE food_master_id = ${loserId}
    `,
    sql<{ conflicts: boolean }[]>`
      SELECT EXISTS(
        SELECT 1 FROM food_master_aliases WHERE alias = ${loser.name}
      ) AS conflicts
    `,
    sql<(UnitRow & { conflicts: boolean })[]>`
      SELECT loser_unit.unit, loser_unit.grams_per_unit,
             EXISTS(
               SELECT 1 FROM food_master_units survivor_unit
               WHERE survivor_unit.food_master_id = ${survivorId}
                 AND survivor_unit.unit = loser_unit.unit
             ) AS conflicts
      FROM food_master_units loser_unit
      WHERE loser_unit.food_master_id = ${loserId}
    `,
    sql<{ nutrient_code: string; value: string }[]>`
      SELECT nutrient_code, value
      FROM food_master_nutrients
      WHERE food_master_id = ${loserId}
    `,
    sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM meal_logs WHERE food_master_id = ${loserId}
    `,
  ])

  return ok({
    survivorId,
    loserId,
    applied: false,
    movedAliases: movedAliasRows.map((r) => r.alias),
    nameMovedAsAlias:
      nameConflictRows[0]?.conflicts === true ? null : loser.name,
    movedUnits: unitRows.filter((r) => !r.conflicts).map(toUnitDefinition),
    discardedUnits: unitRows.filter((r) => r.conflicts).map(toUnitDefinition),
    discardedNutrition: toNutritionMap(discardedNutritionRows),
    movedMealLogCount: mealLogCountRows[0]?.count ?? 0,
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
  const [survivorRows, loserRows] = await Promise.all([
    tx<{ id: string }[]>`
      SELECT id FROM food_masters WHERE id = ${survivorId} FOR UPDATE
    `,
    tx<{ id: string; name: string }[]>`
      SELECT id, name FROM food_masters WHERE id = ${loserId} FOR UPDATE
    `,
  ])
  const survivor = survivorRows[0]
  const loser = loserRows[0]
  if (survivor === undefined) return err(notFoundError(survivorId))
  if (loser === undefined) return err(notFoundError(loserId))

  // Read before the DELETE below cascades these rows away.
  const discardedNutritionRows = await tx<
    { nutrient_code: string; value: string }[]
  >`
    SELECT nutrient_code, value
    FROM food_master_nutrients
    WHERE food_master_id = ${loserId}
  `

  const movedAliasRows = await tx<{ alias: string }[]>`
    UPDATE food_master_aliases SET food_master_id = ${survivorId}
    WHERE food_master_id = ${loserId}
    RETURNING alias
  `

  // alias is globally unique, so the loser's own aliases (just moved above)
  // never collide on survivor — only the loser's *name*, inserted fresh as
  // a new alias row, can already exist as someone else's alias.
  const nameAliasRows = await tx<{ id: string }[]>`
    INSERT INTO food_master_aliases (id, food_master_id, alias)
    VALUES (${generateId('fma')}, ${survivorId}, ${loser.name})
    ON CONFLICT (alias) DO NOTHING
    RETURNING id
  `

  const movedUnitRows = await tx<UnitRow[]>`
    UPDATE food_master_units AS loser_unit
    SET food_master_id = ${survivorId}
    WHERE loser_unit.food_master_id = ${loserId}
      AND NOT EXISTS (
        SELECT 1 FROM food_master_units survivor_unit
        WHERE survivor_unit.food_master_id = ${survivorId}
          AND survivor_unit.unit = loser_unit.unit
      )
    RETURNING unit, grams_per_unit
  `
  // Whatever is still under loserId after the move above conflicted with an
  // already-defined survivor unit and is about to be cascade-deleted.
  const discardedUnitRows = await tx<UnitRow[]>`
    SELECT unit, grams_per_unit
    FROM food_master_units
    WHERE food_master_id = ${loserId}
  `

  const movedMealLogRows = await tx<{ id: string }[]>`
    UPDATE meal_logs SET food_master_id = ${survivorId}
    WHERE food_master_id = ${loserId}
    RETURNING id
  `

  // meal_logs is fully repointed above, so this DELETE never trips the
  // meal_logs FK's ON DELETE RESTRICT; food_master_aliases/_units/_nutrients
  // cascade away whatever was deliberately left under loserId.
  await tx`DELETE FROM food_masters WHERE id = ${loserId}`

  return ok({
    survivorId,
    loserId,
    applied: true,
    movedAliases: movedAliasRows.map((r) => r.alias),
    nameMovedAsAlias: nameAliasRows.length > 0 ? loser.name : null,
    movedUnits: movedUnitRows.map(toUnitDefinition),
    discardedUnits: discardedUnitRows.map(toUnitDefinition),
    discardedNutrition: toNutritionMap(discardedNutritionRows),
    movedMealLogCount: movedMealLogRows.length,
  })
}

export const mergeFoodMasters = (
  sql: Sql,
  generateId: IdGenerator,
  survivorId: FoodMasterId,
  loserId: FoodMasterId,
  dryRun: boolean,
  wrapInTransaction: boolean,
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
