import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { IdGenerator } from '#domain/food-master/id'
import { toNutritionMap, type TxSql } from '#domain/food-master/rows'
import { runInSavepoint } from '#domain/food-master/savepoint'
import type {
  FoodMasterId,
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
const stockLotMergeRowSchema = z.object({
  survivor_lot_id: z.string(),
  loser_lot_id: z.string(),
})
const nutrientRowSchema = z.object({
  nutrient_code: z.string(),
  value: z.string(),
})
const countRowSchema = z.object({ count: z.number() })

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

  const movedMealLogRows = parseRows(
    idRowSchema,
    await tx<Record<string, unknown>[]>`
      UPDATE meal_logs SET food_master_id = ${survivorId}
      WHERE food_master_id = ${loserId}
      RETURNING id
    `,
  )
  if (movedMealLogRows.isErr()) return err(movedMealLogRows.error)

  await tx`
    INSERT INTO meal_set_items (meal_set_id, food_master_id, quantity)
    SELECT meal_set_id, ${survivorId}, quantity
    FROM meal_set_items
    WHERE food_master_id = ${loserId}
    ON CONFLICT (meal_set_id, food_master_id)
    DO UPDATE SET quantity = meal_set_items.quantity + EXCLUDED.quantity
  `
  await tx`DELETE FROM meal_set_items WHERE food_master_id = ${loserId}`

  await tx`
    DELETE FROM stock_items AS loser_item
    WHERE loser_item.food_master_id = ${loserId}
      AND EXISTS (
        SELECT 1 FROM stock_items AS survivor_item
        WHERE survivor_item.food_master_id = ${survivorId}
      )
  `
  await tx`
    UPDATE stock_items SET food_master_id = ${survivorId}
    WHERE food_master_id = ${loserId}
  `
  const deliveryLotRows = parseRows(
    stockLotMergeRowSchema,
    await tx<Record<string, unknown>[]>`
      SELECT survivor.id AS survivor_lot_id, loser.id AS loser_lot_id
      FROM stock_lots survivor
      JOIN stock_lots loser
        ON survivor.delivery_id = loser.delivery_id
      WHERE survivor.delivery_id IS NOT NULL
        AND survivor.food_master_id = ${survivorId}
        AND loser.food_master_id = ${loserId}
      ORDER BY survivor.delivery_id
      FOR UPDATE OF survivor, loser
    `,
  )
  if (deliveryLotRows.isErr()) return err(deliveryLotRows.error)
  for (const lot of deliveryLotRows.value) {
    await tx`
      UPDATE stock_lots AS survivor
      SET quantity = survivor.quantity + loser.quantity,
          received_date = LEAST(survivor.received_date, loser.received_date),
          best_before = LEAST(survivor.best_before, loser.best_before),
          eat_by = LEAST(survivor.eat_by, loser.eat_by)
      FROM stock_lots AS loser
      WHERE survivor.id = ${lot.survivor_lot_id}
        AND loser.id = ${lot.loser_lot_id}
    `
    await tx`
      UPDATE stock_movements
      SET stock_lot_id = ${lot.survivor_lot_id}
      WHERE stock_lot_id = ${lot.loser_lot_id}
    `
    await tx`
      DELETE FROM stock_lots WHERE id = ${lot.loser_lot_id}
    `
  }
  await tx`
    UPDATE stock_lots SET food_master_id = ${survivorId}
    WHERE food_master_id = ${loserId}
  `

  // Referencing rows have been repointed or removed above; aliases and nutrition
  // rows cascade away whatever was deliberately left under loserId.
  await tx`DELETE FROM food_masters WHERE id = ${loserId}`

  return ok({
    survivorId,
    loserId,
    applied: true,
    movedAliases: movedAliasRows.value.map((r) => r.alias),
    nameMovedAsAlias: nameAliasRows.value.length > 0 ? loser.name : null,
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
