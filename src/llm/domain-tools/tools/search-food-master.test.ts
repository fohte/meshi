import { describe, expect, it } from 'vitest'

import type {
  FoodMatchCandidate,
  FoodMatcher,
  SearchFoodInput,
} from '@/domain/food-matcher/food-matcher'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createSearchFoodMasterTool } from '@/llm/domain-tools/tools/search-food-master'

const setup = (override?: {
  search?: (
    input: SearchFoodInput,
  ) => Promise<ReadonlyArray<FoodMatchCandidate>>
}): {
  tool: ReturnType<typeof createSearchFoodMasterTool>
  calls: SearchFoodInput[]
} => {
  const calls: SearchFoodInput[] = []
  const matcher: FoodMatcher = {
    search: (input) => {
      calls.push(input)
      return (
        override?.search?.(input) ??
        Promise.resolve<ReadonlyArray<FoodMatchCandidate>>([
          {
            reason: 'history_recent',
            score: 0.9,
            foodMasterId: 'fm_rice',
            compositionCode: null,
            name: '白米',
            isEstimated: false,
          },
          {
            reason: 'composition_table',
            score: 0.4,
            foodMasterId: null,
            compositionCode: '01088',
            name: 'こめ (玄米)',
            isEstimated: true,
          },
        ])
      )
    },
  }
  return { tool: createSearchFoodMasterTool(matcher), calls }
}

describe('search_food_master tool', () => {
  it('forwards query+limit and normalizes candidates to snake_case', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ query: '白米', limit: 3 })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        candidates: [
          {
            food_master_id: 'fm_rice',
            composition_code: null,
            name: '白米',
            is_estimated: false,
            score: 0.9,
            reason: 'history_recent',
          },
          {
            food_master_id: null,
            composition_code: '01088',
            name: 'こめ (玄米)',
            is_estimated: true,
            score: 0.4,
            reason: 'composition_table',
          },
        ],
      },
    })
    expect(calls).toEqual([{ query: '白米', limit: 3 }])
  })

  it('defaults limit to 5 when not supplied', async () => {
    const { tool, calls } = setup()
    await tool.execute({ query: '白米' })
    expect(calls).toEqual([{ query: '白米', limit: 5 }])
  })

  it('rejects empty query with invalid_input and skips the matcher', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({ query: '' })
    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual([])
  })
})
