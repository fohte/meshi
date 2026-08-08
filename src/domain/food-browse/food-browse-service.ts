import { and, eq, inArray } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import { foodMasterNutrients, foodMasters } from '#db/schema'
import type { FoodBrowseService, FoodListItem } from '#domain/food-browse/types'
import { FoodBrowseQueryError } from '#domain/food-browse/types'
import type { FoodSource } from '#domain/food-master/types'
import type { FoodMatcher } from '#domain/food-matcher/food-matcher'

const ENERGY_KCAL_CODE = 'energy_kcal'

type Db = ReturnType<typeof drizzle>

interface Enrichment {
  readonly source: FoodSource
  readonly energyKcalPer100g: number | null
}

const numericOrNull = (value: string | null): number | null =>
  value === null ? null : Number(value)

// food_master_nutrients.value is "per basisQuantity basisUnit", not always
// per-100g (e.g. a 1-食 restaurant dish). Only a gram basis can be rescaled
// to per-100g; anything else (opaque serving units like '食') has no known
// gram equivalent, so the per-100g comparison is undefined.
const MASS_BASIS_UNIT = 'g'

const toEnergyKcalPer100g = (
  kcalPerBasis: number | null,
  basisQuantity: number,
  basisUnit: string,
): number | null => {
  if (kcalPerBasis === null || basisUnit !== MASS_BASIS_UNIT) return null
  return (kcalPerBasis * 100) / basisQuantity
}

const loadEnrichment = async (
  db: Db,
  foodMasterIds: ReadonlyArray<string>,
): Promise<Map<string, Enrichment>> => {
  if (foodMasterIds.length === 0) return new Map()

  const rows = await db
    .select({
      id: foodMasters.id,
      source: foodMasters.source,
      energyKcal: foodMasterNutrients.value,
      basisQuantity: foodMasters.basisQuantity,
      basisUnit: foodMasters.basisUnit,
    })
    .from(foodMasters)
    .leftJoin(
      foodMasterNutrients,
      and(
        eq(foodMasterNutrients.foodMasterId, foodMasters.id),
        eq(foodMasterNutrients.nutrientCode, ENERGY_KCAL_CODE),
      ),
    )
    .where(inArray(foodMasters.id, [...foodMasterIds]))

  return new Map(
    rows.map((row) => [
      row.id,
      {
        source: row.source,
        energyKcalPer100g: toEnergyKcalPer100g(
          numericOrNull(row.energyKcal),
          Number(row.basisQuantity),
          row.basisUnit,
        ),
      },
    ]),
  )
}

// Rows shared by the recent/frequent raw queries below: both join
// food_masters + food_master_nutrients the same way and differ only in how
// the candidate id set is ranked.
const rawRowSchema = z.object({
  id: z.string(),
  name: z.string(),
  is_estimated: z.boolean(),
  source: z.enum(['web_search', 'composition_table_estimate', 'user_input']),
  energy_kcal: z
    .union([z.number(), z.string()])
    .nullable()
    .transform((v) => (v === null ? null : Number(v))),
  basis_quantity: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  basis_unit: z.string(),
})

const rawRowsSchema = z.array(rawRowSchema)

const toListItem = (
  row: z.infer<typeof rawRowSchema>,
  reason: FoodListItem['reason'],
): FoodListItem => ({
  foodMasterId: row.id,
  compositionCode: null,
  name: row.name,
  isEstimated: row.is_estimated,
  reason,
  source: row.source,
  energyKcalPer100g: toEnergyKcalPer100g(
    row.energy_kcal,
    row.basis_quantity,
    row.basis_unit,
  ),
})

const parseRankedRows = (
  raw: unknown,
  reason: FoodListItem['reason'],
  queryLabel: string,
) => {
  const parsed = rawRowsSchema.safeParse(raw)
  if (!parsed.success) {
    return err(
      new FoodBrowseQueryError(
        `${queryLabel} query returned invalid rows: ${parsed.error.message}`,
      ),
    )
  }
  return ok(parsed.data.map((row) => toListItem(row, reason)))
}

export const createFoodBrowseService = (
  sql: Sql,
  foodMatcher: FoodMatcher,
): FoodBrowseService => {
  const db: Db = drizzle(sql)

  return {
    search: (query, limit) =>
      foodMatcher.search({ queries: [query], limit }).andThen((candidates) =>
        ResultAsync.fromPromise(
          loadEnrichment(
            db,
            candidates.map((c) => c.foodMasterId).filter((id) => id !== null),
          ),
          (caughtErr) =>
            new FoodBrowseQueryError(
              'failed to enrich food search results',
              caughtErr,
            ),
        ).map((enrichment) =>
          candidates.map((candidate): FoodListItem => {
            const enriched =
              candidate.foodMasterId === null
                ? undefined
                : enrichment.get(candidate.foodMasterId)
            return {
              foodMasterId: candidate.foodMasterId,
              compositionCode: candidate.compositionCode,
              name: candidate.name,
              isEstimated: candidate.isEstimated,
              reason: candidate.reason,
              source: enriched?.source ?? null,
              energyKcalPer100g: enriched?.energyKcalPer100g ?? null,
            }
          }),
        ),
      ),

    listRecent: (limit) =>
      ResultAsync.fromPromise(
        sql`
          SELECT fm.id, fm.name, fm.is_estimated, fm.source, fmn.value AS energy_kcal,
            fm.basis_quantity, fm.basis_unit
          FROM (
            SELECT food_master_id, MAX(eaten_date) AS last_eaten_date
            FROM meal_logs
            GROUP BY food_master_id
            ORDER BY last_eaten_date DESC, food_master_id ASC
            LIMIT ${limit}
          ) recent
          JOIN food_masters fm ON fm.id = recent.food_master_id
          LEFT JOIN food_master_nutrients fmn
            ON fmn.food_master_id = fm.id AND fmn.nutrient_code = ${ENERGY_KCAL_CODE}
          ORDER BY recent.last_eaten_date DESC, fm.id ASC
        `,
        (caughtErr) =>
          new FoodBrowseQueryError('recent foods query failed', caughtErr),
      ).andThen((raw) =>
        parseRankedRows(raw, 'history_recent', 'recent foods'),
      ),

    listFrequent: (limit) =>
      ResultAsync.fromPromise(
        sql`
          SELECT fm.id, fm.name, fm.is_estimated, fm.source, fmn.value AS energy_kcal,
            fm.basis_quantity, fm.basis_unit
          FROM (
            SELECT food_master_id, COUNT(*) AS cnt
            FROM meal_logs
            GROUP BY food_master_id
            ORDER BY cnt DESC, food_master_id ASC
            LIMIT ${limit}
          ) freq
          JOIN food_masters fm ON fm.id = freq.food_master_id
          LEFT JOIN food_master_nutrients fmn
            ON fmn.food_master_id = fm.id AND fmn.nutrient_code = ${ENERGY_KCAL_CODE}
          ORDER BY freq.cnt DESC, fm.name ASC
        `,
        (caughtErr) =>
          new FoodBrowseQueryError('frequent foods query failed', caughtErr),
      ).andThen((raw) =>
        parseRankedRows(raw, 'history_frequent', 'frequent foods'),
      ),
  }
}
