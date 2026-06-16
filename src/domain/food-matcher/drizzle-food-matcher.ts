import { z } from 'zod'

import type { Sql } from '@/db'
import type {
  FoodMatchCandidate,
  FoodMatcher,
  FoodMatchReason,
  SearchFoodInput,
} from '@/domain/food-matcher/food-matcher'

export interface DrizzleFoodMatcherConfig {
  // A log eaten within this many days is treated as recent.
  readonly recentDays?: number
  // A food eaten at least this many times is treated as frequent.
  readonly frequentMinCount?: number
}

const DEFAULT_RECENT_DAYS = 7
const DEFAULT_FREQUENT_MIN_COUNT = 2

const reasonSchema = z.enum([
  'history_recent',
  'history_frequent',
  'fuzzy_name',
  'composition_table',
])

const rowSchema = z.object({
  food_master_id: z.string().nullable(),
  composition_code: z.string().nullable(),
  name: z.string(),
  is_estimated: z.boolean(),
  reason: reasonSchema,
  // postgres-js returns numeric / float as string for safety; accept both.
  // Reject NaN / Infinity instead of silently propagating them through the
  // pipeline (Number("abc") is NaN, which the score-based ORDER BY hides).
  score: z.union([
    z.number().refine(Number.isFinite),
    z.string().transform((s, ctx) => {
      const n = Number(s)
      if (!Number.isFinite(n)) {
        ctx.addIssue({
          code: 'custom',
          message: `expected a finite numeric, got ${s}`,
        })
        return z.NEVER
      }
      return n
    }),
  ]),
})

const rowsSchema = z.array(rowSchema)

export class FoodMatcherInvalidRowError extends Error {
  public readonly issues: z.ZodError
  // The offending raw rows. Held non-enumerable so error loggers (e.g. pino's
  // default err serializer, which iterates own enumerable props) don't dump
  // the full result set — only `message` and `issues` are surfaced by default.
  public readonly raw: unknown

  constructor(issues: z.ZodError, raw: unknown) {
    super(`food matcher returned an invalid row: ${issues.message}`)
    this.name = 'FoodMatcherInvalidRowError'
    this.cause = issues
    this.issues = issues
    Object.defineProperty(this, 'raw', {
      value: raw,
      enumerable: false,
      writable: false,
      configurable: false,
    })
  }
}

export const createDrizzleFoodMatcher = (
  sql: Sql,
  config: DrizzleFoodMatcherConfig = {},
): FoodMatcher => {
  const recentDays = config.recentDays ?? DEFAULT_RECENT_DAYS
  const frequentMinCount = config.frequentMinCount ?? DEFAULT_FREQUENT_MIN_COUNT

  return {
    async search(
      input: SearchFoodInput,
    ): Promise<ReadonlyArray<FoodMatchCandidate>> {
      const { query, limit } = input
      if (query.trim() === '' || limit <= 0) return []

      const raw = await sql`
        WITH
        -- Two index-friendly seeks (name trgm + alias trgm) UNION-ed and
        -- aggregated. A single LATERAL with an OR predicate across name and
        -- alias defeats the planner's ability to push either trigram
        -- predicate into its GIN index, forcing an O(N) scan of food_masters.
        name_matches AS (
          SELECT id, name, is_estimated, MAX(name_sim) AS name_sim
          FROM (
            SELECT fm.id, fm.name, fm.is_estimated,
                   similarity(fm.name, ${query}) AS name_sim
            FROM food_masters fm
            WHERE fm.name % ${query}
            UNION ALL
            SELECT fm.id, fm.name, fm.is_estimated,
                   similarity(fma.alias, ${query}) AS name_sim
            FROM food_master_aliases fma
            JOIN food_masters fm ON fm.id = fma.food_master_id
            WHERE fma.alias % ${query}
          ) _
          GROUP BY id, name, is_estimated
        ),
        history_stats AS (
          SELECT
            ml.food_master_id,
            COUNT(*)::int AS cnt,
            EXTRACT(EPOCH FROM (now() - MAX(ml.eaten_at))) / 86400.0
              AS days_since
          FROM meal_logs ml
          JOIN name_matches nm ON nm.id = ml.food_master_id
          GROUP BY ml.food_master_id
        ),
        master_candidates AS (
          SELECT
            nm.id AS food_master_id,
            NULL::text AS composition_code,
            nm.name,
            nm.is_estimated,
            CASE
              WHEN hs.cnt IS NULL THEN 'fuzzy_name'
              WHEN hs.days_since <= ${recentDays} THEN 'history_recent'
              WHEN hs.cnt >= ${frequentMinCount} THEN 'history_frequent'
              ELSE 'fuzzy_name'
            END AS reason,
            CASE
              WHEN hs.cnt IS NULL THEN nm.name_sim
              WHEN hs.days_since <= ${recentDays} THEN
                2.0 + nm.name_sim * (1.0 / (1.0 + GREATEST(hs.days_since, 0)))
              WHEN hs.cnt >= ${frequentMinCount} THEN
                1.0 + nm.name_sim * (1.0 - exp(-hs.cnt::float / 3.0))
              ELSE nm.name_sim
            END AS score
          FROM name_matches nm
          LEFT JOIN history_stats hs ON hs.food_master_id = nm.id
        ),
        composition_candidates AS (
          SELECT
            NULL::text AS food_master_id,
            fc.code AS composition_code,
            fc.name,
            true AS is_estimated,
            'composition_table'::text AS reason,
            similarity(fc.name, ${query})::float AS score
          FROM food_compositions fc
          WHERE fc.name % ${query}
            AND NOT EXISTS (SELECT 1 FROM master_candidates)
        )
        SELECT food_master_id, composition_code, name, is_estimated,
               reason, score
        FROM master_candidates
        UNION ALL
        SELECT food_master_id, composition_code, name, is_estimated,
               reason, score
        FROM composition_candidates
        ORDER BY score DESC, name ASC
        LIMIT ${limit}
      `

      const parsed = rowsSchema.safeParse(raw)
      if (!parsed.success) {
        throw new FoodMatcherInvalidRowError(parsed.error, raw)
      }

      return parsed.data.map<FoodMatchCandidate>((r) => ({
        reason: r.reason satisfies FoodMatchReason,
        score: r.score,
        foodMasterId: r.food_master_id,
        compositionCode: r.composition_code,
        name: r.name,
        isEstimated: r.is_estimated,
      }))
    },
  }
}
