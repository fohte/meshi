import { drizzle } from 'drizzle-orm/postgres-js'
import { err, ok, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import {
  ENERGY_KCAL_CODE,
  loadFoodMasterEnrichment,
} from '#domain/food-browse/food-enrichment'
import type { FoodBrowseService, FoodListItem } from '#domain/food-browse/types'
import { FoodBrowseQueryError } from '#domain/food-browse/types'
import type { FoodMatcher } from '#domain/food-matcher/food-matcher'

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
    .transform(Number)
    .pipe(z.number())
    .nullable(),
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
  energyKcalPerUnit: row.energy_kcal,
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
  const db = drizzle(sql)

  return {
    search: (query, limit) =>
      // A human manually browsing food_master doesn't declare retail/homemade
      // intent the way the meal-logging agent does, so 'homemade' is passed
      // to keep composition_table fallback candidates visible in browse
      // results regardless.
      foodMatcher
        .search({ queries: [query], origin: 'homemade', limit })
        .andThen((candidates) =>
          loadFoodMasterEnrichment(
            db,
            candidates.map((c) => c.foodMasterId).filter((id) => id !== null),
          )
            .mapErr(
              (caughtErr) =>
                new FoodBrowseQueryError(
                  'failed to enrich food search results',
                  caughtErr,
                ),
            )
            .map((enrichment) =>
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
                  energyKcalPerUnit: enriched?.energyKcalPerUnit ?? null,
                }
              }),
            ),
        ),

    listRecent: (limit) =>
      ResultAsync.fromPromise(
        sql`
          SELECT fm.id, fm.name, fm.is_estimated, fm.source, fmn.value AS energy_kcal
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
          SELECT fm.id, fm.name, fm.is_estimated, fm.source, fmn.value AS energy_kcal
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
