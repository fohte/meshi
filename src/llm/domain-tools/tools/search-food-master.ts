import { z } from 'zod'

import type {
  FoodMatchCandidate,
  FoodMatcher,
} from '#domain/food-matcher/food-matcher'
import { toInternalToolError } from '#llm/domain-tools/internal-error'
import { parseToolInput } from '#llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  ok,
  type Result,
  type ToolError,
} from '#llm/domain-tools/types'

const MAX_QUERIES = 10

const inputSchema = z.object({
  queries: z.array(z.string().min(1)).min(1).max(MAX_QUERIES),
  limit: z.number().int().positive().max(50).optional().default(5),
})

export interface SearchFoodMasterCandidate {
  readonly food_master_id: string | null
  readonly composition_code: string | null
  readonly name: string
  readonly is_estimated: boolean
  readonly score: number
  readonly reason: string
  readonly matched_queries: ReadonlyArray<string>
}

export interface SearchFoodMasterOutput {
  readonly candidates: ReadonlyArray<SearchFoodMasterCandidate>
}

const toOutput = (
  candidates: ReadonlyArray<FoodMatchCandidate>,
): SearchFoodMasterOutput => ({
  candidates: candidates.map((c) => ({
    food_master_id: c.foodMasterId,
    composition_code: c.compositionCode,
    name: c.name,
    is_estimated: c.isEstimated,
    score: c.score,
    reason: c.reason,
    matched_queries: c.matchedQueries,
  })),
})

// A candidate's `nameSim` is the raw trigram similarity between the query
// and the matched name/alias, unlike `score`, which a history bonus can
// push above 1.0 even when the name barely overlaps with the query — a
// food_master matched only by a shared store-name token (e.g. a convenience
// store's name inside a longer alias) scored name_sim=0.4211 in production
// while still ranking first once the frequent-history bonus applied,
// silently skipping the retry below. 0.5 is the lowest name_sim among the
// intentionally-designed "still a genuine match" cases in
// drizzle-food-matcher.test.ts (a query matching only a fragment of the
// registered name with no word boundary) — high enough to catch the
// observed noise, low enough not to flag those as unusable.
const MIN_USABLE_NAME_SIM = 0.5

const hasUsableCandidate = (
  candidates: ReadonlyArray<FoodMatchCandidate>,
): boolean => candidates.some((c) => c.nameSim >= MIN_USABLE_NAME_SIM)

// A query the LLM padded with words the registered name doesn't have (e.g.
// "ゲンキ プロテイン飲料" for a master named "ゲンキ ウェイトダウン
// チョコレート") can miss every match condition at once, even though a
// shorter fragment of it ("ゲンキ") would hit. Splitting on whitespace and
// retrying with only the fragments not already tried gives the matcher a
// second, cheaper shot without depending on the LLM to reformulate on its
// own — skipped when splitting yields nothing new (a single-token query has
// nothing to split into).
const deriveShortQueries = (
  queries: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const original = new Set(queries)
  const short = new Set<string>()
  for (const query of queries) {
    for (const token of query.split(/\s+/)) {
      if (token !== '' && !original.has(token)) short.add(token)
    }
  }
  // Bounded the same as the original input (MAX_QUERIES) — an adversarial or
  // malformed query with many whitespace-separated tokens would otherwise
  // uncap the retry's query count.
  return [...short].slice(0, MAX_QUERIES)
}

export const createSearchFoodMasterTool = (
  matcher: FoodMatcher,
): DomainTool => ({
  name: 'search_food_master',
  description:
    'Search the food_master table by one or more free-text queries. Pass several phrasings of the same food in one call (different levels of detail, a brand name alone, a romanized spelling, ...) — results are merged into a single ranked list, and each candidate reports which of the queries matched it. If every query comes back empty, the tool automatically retries with each query broken into its individual words before giving up. Returns ranked candidates including history-derived hits, fuzzy name matches, and composition-table fallbacks.',
  // io: 'input' — this describes the pre-parse wire shape a caller (LLM tool
  // call) must supply, not zod's parsed output shape; without it, `limit`'s
  // `.default(5)` makes toJSONSchema mark it `required` (it's always present
  // post-parse), which rejects a real caller that omits it.
  inputSchema: z.toJSONSchema(inputSchema, { io: 'input' }),
  async execute(
    input: unknown,
  ): Promise<Result<SearchFoodMasterOutput, ToolError>> {
    const parsed = parseToolInput(inputSchema, input)
    if (parsed.isErr()) return err(parsed.error)
    const { queries, limit } = parsed.value

    const first = await matcher.search({ queries, limit })
    if (first.isErr()) return err(toInternalToolError(first.error))
    if (hasUsableCandidate(first.value)) return ok(toOutput(first.value))

    const shortQueries = deriveShortQueries(queries)
    if (shortQueries.length === 0) return ok(toOutput(first.value))

    return (await matcher.search({ queries: shortQueries, limit }))
      .map(toOutput)
      .mapErr(toInternalToolError)
  },
})
