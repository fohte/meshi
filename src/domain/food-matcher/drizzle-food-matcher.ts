import { err, ok, okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import type { Sql } from '#db/index'
import type {
  FoodMatchCandidate,
  FoodMatcher,
  FoodMatchReason,
  SearchFoodInput,
} from '#domain/food-matcher/food-matcher'

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

// postgres-js returns numeric / float as string for safety; accept both.
// Reject NaN / Infinity instead of silently propagating them through the
// pipeline (Number("abc") is NaN, which the score-based ORDER BY hides).
const finiteNumeric = z.union([
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
])

const rowSchema = z.object({
  food_master_id: z.string().nullable(),
  composition_code: z.string().nullable(),
  name: z.string(),
  is_estimated: z.boolean(),
  reason: reasonSchema,
  matched_queries: z.array(z.string()),
  score: finiteNumeric,
  name_sim: finiteNumeric,
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

export class FoodMatcherQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodMatcherQueryError'
  }
}

export const createDrizzleFoodMatcher = (
  sql: Sql,
  config: DrizzleFoodMatcherConfig = {},
): FoodMatcher => {
  const recentDays = config.recentDays ?? DEFAULT_RECENT_DAYS
  const frequentMinCount = config.frequentMinCount ?? DEFAULT_FREQUENT_MIN_COUNT

  return {
    search(
      input: SearchFoodInput,
    ): ResultAsync<
      ReadonlyArray<FoodMatchCandidate>,
      FoodMatcherInvalidRowError | FoodMatcherQueryError
    > {
      const { limit, origin } = input
      const queries = input.queries.map((q) => q.trim()).filter((q) => q !== '')
      if (queries.length === 0 || limit <= 0) return okAsync([])

      return ResultAsync.fromPromise(
        sql`
        WITH
        -- Each candidate is matched against every input query via three
        -- OR'd conditions: similarity's % operator (catches near-typos, but
        -- its score drops as the query grows longer than the registered
        -- name), word_similarity's indexable %> commutator (catches a short
        -- or partial query, e.g. a bare brand name, fully contained in a
        -- longer registered name), and a plain substring check (catches a
        -- query with no natural word boundary in the name). name_sim then
        -- takes the strongest of similarity/word_similarity across whichever
        -- condition matched, so a query padded with extra words the name
        -- doesn't have still scores by its best-contained fragment instead
        -- of being diluted by the whole-string similarity.
        --
        -- Two index-friendly seeks (name trgm + alias trgm) UNION-ed and
        -- aggregated. Mixing the non-trgm-indexable substring check into the
        -- same OR predicate means Postgres can no longer prove the GIN index
        -- covers every case, so each branch falls back to a sequential scan.
        -- Splitting the substring check into its own UNION ALL branch
        -- restores index pushdown for the % / %> conditions if that scan
        -- ever needs to be avoided.
        name_matches AS (
          SELECT id, name, is_estimated,
                 MAX(name_sim) AS name_sim,
                 array_agg(DISTINCT matched_query ORDER BY matched_query) AS matched_queries
          FROM (
            SELECT fm.id, fm.name, fm.is_estimated, q AS matched_query,
                   GREATEST(similarity(fm.name, q), word_similarity(q, fm.name)) AS name_sim
            FROM food_masters fm
            CROSS JOIN unnest(${queries}::text[]) AS q
            WHERE fm.name % q OR fm.name %> q OR strpos(lower(fm.name), lower(q)) > 0
            UNION ALL
            SELECT fm.id, fm.name, fm.is_estimated, q AS matched_query,
                   GREATEST(similarity(fma.alias, q), word_similarity(q, fma.alias)) AS name_sim
            FROM food_master_aliases fma
            JOIN food_masters fm ON fm.id = fma.food_master_id
            CROSS JOIN unnest(${queries}::text[]) AS q
            WHERE fma.alias % q OR fma.alias %> q OR strpos(lower(fma.alias), lower(q)) > 0
          ) _
          GROUP BY id, name, is_estimated
        ),
        history_stats AS (
          SELECT
            ml.food_master_id,
            COUNT(*)::int AS cnt,
            (((CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Tokyo')::date) - MAX(ml.eaten_date)) AS days_since
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
            nm.matched_queries,
            nm.name_sim,
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
        -- A composition entry names a raw ingredient, not a product, so it's
        -- only a safe fallback for something the user assembled themselves —
        -- never for a specific packaged/prepared product. Gated on origin
        -- (declared by the caller, not inferrable from the query text) only:
        -- composition candidates appear for every homemade query regardless
        -- of whether a food_master already matched.
        composition_candidates AS (
          SELECT
            NULL::text AS food_master_id,
            code AS composition_code,
            name,
            true AS is_estimated,
            matched_queries,
            'composition_table'::text AS reason,
            name_sim::float AS score,
            name_sim::float AS name_sim
          FROM (
            SELECT fc.code, fc.name,
                   MAX(GREATEST(similarity(fc.name, q), word_similarity(q, fc.name))) AS name_sim,
                   array_agg(DISTINCT q ORDER BY q) AS matched_queries
            FROM food_compositions fc
            CROSS JOIN unnest(${queries}::text[]) AS q
            WHERE fc.name % q OR fc.name %> q OR strpos(lower(fc.name), lower(q)) > 0
            GROUP BY fc.code, fc.name
          ) _
          WHERE ${origin} = 'homemade'
        )
        SELECT food_master_id, composition_code, name, is_estimated,
               reason, score, name_sim, matched_queries
        FROM master_candidates
        UNION ALL
        SELECT food_master_id, composition_code, name, is_estimated,
               reason, score, name_sim, matched_queries
        FROM composition_candidates
        ORDER BY score DESC, name ASC
        LIMIT ${limit}
      `,
        (caughtErr) =>
          new FoodMatcherQueryError('food matcher query failed', caughtErr),
      ).andThen((raw) => {
        const parsed = rowsSchema.safeParse(raw)
        if (!parsed.success) {
          return err(new FoodMatcherInvalidRowError(parsed.error, raw))
        }
        return ok(
          parsed.data.map<FoodMatchCandidate>((r) => ({
            reason: r.reason satisfies FoodMatchReason,
            score: r.score,
            nameSim: r.name_sim,
            foodMasterId: r.food_master_id,
            compositionCode: r.composition_code,
            name: r.name,
            isEstimated: r.is_estimated,
            matchedQueries: r.matched_queries,
          })),
        )
      })
    },
  }
}
