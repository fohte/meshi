import { z } from 'zod'

import type { FoodMatcher } from '@/domain/food-matcher/food-matcher'
import { toInternalToolError } from '@/llm/domain-tools/internal-error'
import { parseToolInput } from '@/llm/domain-tools/parse'
import {
  type DomainTool,
  err,
  type Result,
  type ToolError,
} from '@/llm/domain-tools/types'

const inputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().positive().max(50).optional().default(5),
})

export interface SearchFoodMasterCandidate {
  readonly food_master_id: string | null
  readonly composition_code: string | null
  readonly name: string
  readonly is_estimated: boolean
  readonly score: number
  readonly reason: string
}

export interface SearchFoodMasterOutput {
  readonly candidates: ReadonlyArray<SearchFoodMasterCandidate>
}

export const createSearchFoodMasterTool = (
  matcher: FoodMatcher,
): DomainTool => ({
  name: 'search_food_master',
  description:
    'Search the food_master table by free-text query. Returns ranked candidates including history-derived hits, fuzzy name matches, and composition-table fallbacks.',
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
    return await matcher
      .search({ query: parsed.value.query, limit: parsed.value.limit })
      .map((candidates) => ({
        candidates: candidates.map((c) => ({
          food_master_id: c.foodMasterId,
          composition_code: c.compositionCode,
          name: c.name,
          is_estimated: c.isEstimated,
          score: c.score,
          reason: c.reason,
        })),
      }))
      .mapErr(toInternalToolError)
  },
})
