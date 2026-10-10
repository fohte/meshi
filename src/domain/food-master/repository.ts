import { err, errAsync, ok, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { errorMessage, FoodMasterDomainError } from '#domain/food-master/errors'
import { defaultIdGenerator, type IdGenerator } from '#domain/food-master/id'
import { mergeFoodMasters } from '#domain/food-master/merge-repository'
import { createFoodMasterRegistrar } from '#domain/food-master/registration'
import { toNutritionMap } from '#domain/food-master/rows'
import type {
  FoodMaster,
  FoodMasterId,
  MergeFoodMasterResult,
  NutritionMap,
  RegisterFoodMasterInput,
  RegisterFoodMasterWithoutNutritionInput,
  SimilarFoodMasterCandidate,
} from '#domain/food-master/types'
import { nutritionStatusFromIsEstimated } from '#domain/food-master/types'

interface FoodComposition {
  readonly name: string
  readonly nutrition: NutritionMap
}

export interface FoodMasterRepository {
  register(
    input: RegisterFoodMasterInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  registerWithoutNutrition(
    input: RegisterFoodMasterWithoutNutritionInput,
  ): ResultAsync<FoodMaster, FoodMasterDomainError>
  findById(
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError>
  findComposition(
    code: string,
  ): ResultAsync<FoodComposition | null, FoodMasterDomainError>
  findSimilarNames(
    name: string,
  ): ResultAsync<
    ReadonlyArray<SimilarFoodMasterCandidate>,
    FoodMasterDomainError
  >
  // Best-effort: silently no-ops (via ON CONFLICT DO NOTHING) instead of
  // erroring when `alias` already belongs to any food_master, including this
  // one — callers that learn an alias from user behavior (e.g. a corrected
  // meal_log) shouldn't fail on a collision they have no way to resolve.
  addAlias(
    foodMasterId: FoodMasterId,
    alias: string,
  ): ResultAsync<void, FoodMasterDomainError>
  // dryRun=true only SELECTs and predicts the plan; dryRun=false performs it
  // in one transaction. See MergeFoodMasterResult for what's reported.
  merge(
    survivorId: FoodMasterId,
    loserId: FoodMasterId,
    dryRun: boolean,
  ): ResultAsync<MergeFoodMasterResult, FoodMasterDomainError>
}

interface CreateRepositoryOptions {
  readonly generateId?: IdGenerator
  // Wrap `register`'s writes in `sql.begin` (default) so a single registration
  // is atomic at the boundary. Set false when the caller already runs inside a
  // transaction (per-test transactions in unit tests) — postgres-js rejects a
  // nested BEGIN, and the outer transaction already provides atomicity.
  readonly wrapInTransaction?: boolean
}

// word_similarity(), not similarity(): it scores the best-matching substring
// instead of diluting over the whole string, so a name that shares a brand
// prefix with an existing one but differs in trailing qualifiers still scores
// high enough to be flagged.
const SIMILAR_NAME_SCORE_THRESHOLD = 0.2
const SIMILAR_NAME_LIMIT = 5

const similarNameRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  score: z.number(),
})

const foodMasterRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_estimated: z.boolean().nullable(),
  source: z
    .enum(['web_search', 'composition_table_estimate', 'user_input'])
    .nullable(),
  source_url: z.string().nullable(),
  source_composition_code: z.string().nullable(),
  created_at: z.date(),
})

export const createFoodMasterRepository = (
  sql: Sql,
  options: CreateRepositoryOptions = {},
): FoodMasterRepository => {
  const generateId = options.generateId ?? defaultIdGenerator
  const wrapInTransaction = options.wrapInTransaction ?? true
  const registrar = createFoodMasterRegistrar(
    sql,
    generateId,
    wrapInTransaction,
  )
  const { register, registerWithoutNutrition } = registrar

  const findById = (
    id: FoodMasterId,
  ): ResultAsync<FoodMaster | null, FoodMasterDomainError> =>
    ResultAsync.fromPromise(
      sql<Record<string, unknown>[]>`
        SELECT fm.id, fm.name, fmn.is_estimated, fmn.source,
               fmn.source_url, fmn.source_composition_code, fm.created_at
        FROM food_masters fm
        LEFT JOIN food_master_nutrition fmn ON fmn.food_master_id = fm.id
        WHERE fm.id = ${id}
      `,
      (caughtErr) =>
        new FoodMasterDomainError(
          'persistence_failed',
          errorMessage(caughtErr),
          {},
          caughtErr,
        ),
    ).andThen((rows) => {
      const parsed = z.array(foodMasterRowSchema).safeParse(rows)
      if (!parsed.success) {
        return errAsync(
          new FoodMasterDomainError(
            'persistence_failed',
            `findById returned an invalid row: ${parsed.error.message}`,
          ),
        )
      }
      const row = parsed.data[0]
      if (row === undefined) return okAsync(null)

      return ResultAsync.fromPromise(
        (async () => {
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
            isEstimated: row.is_estimated ?? false,
            nutritionStatus: nutritionStatusFromIsEstimated(row.is_estimated),
            source: row.source,
            sourceUrl: row.source_url,
            sourceCompositionCode: row.source_composition_code,
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
    })

  const findComposition = (
    code: string,
  ): ResultAsync<FoodComposition | null, FoodMasterDomainError> =>
    ResultAsync.fromPromise(
      (async () => {
        const rows = await sql<{ name: string }[]>`
          SELECT name FROM food_compositions WHERE code = ${code}
        `
        const row = rows[0]
        if (row === undefined) return null

        const nutrientRows = await sql<
          { nutrient_code: string; value: string }[]
        >`
          SELECT nutrient_code, value
          FROM food_composition_nutrients
          WHERE food_composition_code = ${code}
        `
        return { name: row.name, nutrition: toNutritionMap(nutrientRows) }
      })(),
      (caughtErr) =>
        new FoodMasterDomainError(
          'persistence_failed',
          errorMessage(caughtErr),
          {},
          caughtErr,
        ),
    )

  const findSimilarNames = (
    name: string,
  ): ResultAsync<
    ReadonlyArray<SimilarFoodMasterCandidate>,
    FoodMasterDomainError
  > =>
    ResultAsync.fromPromise(
      sql`
        WITH scored AS (
          SELECT id, name,
                 GREATEST(
                   word_similarity(${name}, name),
                   word_similarity(name, ${name})
                 ) AS score
          FROM food_masters
          WHERE name <> ${name}
        )
        SELECT id, name, score
        FROM scored
        WHERE score >= ${SIMILAR_NAME_SCORE_THRESHOLD}
        ORDER BY score DESC
        LIMIT ${SIMILAR_NAME_LIMIT}
      `,
      (caughtErr) =>
        new FoodMasterDomainError(
          'persistence_failed',
          errorMessage(caughtErr),
          {},
          caughtErr,
        ),
    ).andThen((raw) => {
      const parsed = z.array(similarNameRowSchema).safeParse(raw)
      if (!parsed.success) {
        return err(
          new FoodMasterDomainError(
            'persistence_failed',
            `findSimilarNames returned an invalid row: ${parsed.error.message}`,
          ),
        )
      }
      return ok(
        parsed.data.map((r) => ({
          foodMasterId: r.id,
          name: r.name,
          score: r.score,
        })),
      )
    })

  const addAlias = (
    foodMasterId: FoodMasterId,
    alias: string,
  ): ResultAsync<void, FoodMasterDomainError> =>
    ResultAsync.fromPromise(
      sql`
        INSERT INTO food_master_aliases (id, food_master_id, alias)
        VALUES (${generateId('fma')}, ${foodMasterId}, ${alias})
        ON CONFLICT (alias) DO NOTHING
      `,
      (caughtErr) =>
        new FoodMasterDomainError(
          'persistence_failed',
          errorMessage(caughtErr),
          {},
          caughtErr,
        ),
    ).map(() => undefined)

  const merge = (
    survivorId: FoodMasterId,
    loserId: FoodMasterId,
    dryRun: boolean,
  ): ResultAsync<MergeFoodMasterResult, FoodMasterDomainError> =>
    mergeFoodMasters(sql, generateId, survivorId, loserId, {
      dryRun,
      wrapInTransaction,
    })

  return {
    register,
    registerWithoutNutrition,
    findById,
    findComposition,
    findSimilarNames,
    addAlias,
    merge,
  }
}
