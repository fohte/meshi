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

// A query the LLM padded with words the registered name doesn't have (e.g.
// "ザバス プロテイン飲料" for a master named "ザバス ウェイトダウン
// チョコレート") can miss every match condition at once, even though a
// shorter fragment of it ("ザバス") would hit. Splitting on whitespace and
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
  return [...short]
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
    if (first.value.length > 0) return ok(toOutput(first.value))

    const shortQueries = deriveShortQueries(queries)
    if (shortQueries.length === 0) return ok(toOutput(first.value))

    return (await matcher.search({ queries: shortQueries, limit }))
      .map(toOutput)
      .mapErr(toInternalToolError)
  },
})
