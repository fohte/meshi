import { errAsync, okAsync, type ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMatcherQueryError } from '#domain/food-matcher/drizzle-food-matcher'
import type {
  FoodMatchCandidate,
  FoodMatcher,
  FoodMatcherError,
  SearchFoodInput,
} from '#domain/food-matcher/food-matcher'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createSearchFoodMasterTool } from '#llm/domain-tools/tools/search-food-master'

const setup = (override?: {
  search?: (
    input: SearchFoodInput,
  ) => ResultAsync<ReadonlyArray<FoodMatchCandidate>, FoodMatcherError>
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
        okAsync<ReadonlyArray<FoodMatchCandidate>, FoodMatcherError>([
          {
            reason: 'history_recent',
            score: 0.9,
            nameSim: 1,
            foodMasterId: 'fm_rice',
            compositionCode: null,
            name: '白米',
            isEstimated: false,
            matchedQueries: ['白米'],
          },
          {
            reason: 'composition_table',
            score: 0.4,
            nameSim: 0.4,
            foodMasterId: null,
            compositionCode: '01088',
            name: 'こめ (玄米)',
            isEstimated: true,
            matchedQueries: ['白米'],
          },
        ])
      )
    },
  }
  return { tool: createSearchFoodMasterTool(matcher), calls }
}

describe('search_food_master tool', () => {
  it('forwards queries+limit and normalizes candidates to snake_case', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ queries: ['白米'], limit: 3 })

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
            matched_queries: ['白米'],
          },
          {
            food_master_id: null,
            composition_code: '01088',
            name: 'こめ (玄米)',
            is_estimated: true,
            score: 0.4,
            reason: 'composition_table',
            matched_queries: ['白米'],
          },
        ],
      },
    })
    expect(calls).toEqual([{ queries: ['白米'], limit: 3 }])
  })

  it('defaults limit to 5 when not supplied', async () => {
    const { tool, calls } = setup()
    await tool.execute({ queries: ['白米'] })
    expect(calls).toEqual([{ queries: ['白米'], limit: 5 }])
  })

  it('rejects an empty queries array with invalid_input and skips the matcher', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({ queries: [] })
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

  it('maps a FoodMatcherError to internal_error', async () => {
    const { tool } = setup({
      search: () =>
        errAsync(new FoodMatcherQueryError('food matcher query failed')),
    })

    const result = await tool.execute({ queries: ['白米'] })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: { code: 'internal_error', message: '<dynamic>' },
    })
  })

  describe('retry with derived short queries', () => {
    it.each([
      {
        label: 'the first call returns no candidates',
        firstResult: [] as ReadonlyArray<FoodMatchCandidate>,
      },
      {
        label: 'the only candidate is below the usable name-sim threshold',
        firstResult: [
          {
            reason: 'history_frequent',
            score: 1.2,
            nameSim: 0.42,
            foodMasterId: 'fm_unrelated',
            compositionCode: null,
            name: '無関係な商品',
            isEstimated: false,
            matchedQueries: ['ゲンキ プロテイン'],
          },
        ] as ReadonlyArray<FoodMatchCandidate>,
      },
    ])(
      'retries with derived short queries when $label',
      async ({ firstResult }) => {
        const { tool, calls } = setup({
          search: (input) =>
            input.queries.includes('ゲンキ プロテイン')
              ? okAsync(firstResult)
              : okAsync([
                  {
                    reason: 'fuzzy_name',
                    score: 1,
                    nameSim: 1,
                    foodMasterId: 'fm_genki',
                    compositionCode: null,
                    name: 'ゲンキ ウェイトダウン チョコレート',
                    isEstimated: false,
                    matchedQueries: ['ゲンキ'],
                  },
                ]),
        })

        const result = await tool.execute({
          queries: ['ゲンキ プロテイン'],
          limit: 5,
        })

        expect(normalizeResult(result)).toEqual({
          ok: true,
          value: {
            candidates: [
              {
                food_master_id: 'fm_genki',
                composition_code: null,
                name: 'ゲンキ ウェイトダウン チョコレート',
                is_estimated: false,
                score: 1,
                reason: 'fuzzy_name',
                matched_queries: ['ゲンキ'],
              },
            ],
          },
        })
        expect(calls).toEqual([
          { queries: ['ゲンキ プロテイン'], limit: 5 },
          { queries: ['ゲンキ', 'プロテイン'], limit: 5 },
        ])
      },
    )

    it('falls back to the first call candidates when the retry finds nothing at all', async () => {
      const { tool, calls } = setup({
        search: (input) =>
          input.queries.includes('ゲンキ プロテイン')
            ? okAsync([
                {
                  reason: 'history_frequent',
                  score: 1.2,
                  nameSim: 0.42,
                  foodMasterId: 'fm_unrelated',
                  compositionCode: null,
                  name: '無関係な商品',
                  isEstimated: false,
                  matchedQueries: ['ゲンキ プロテイン'],
                },
              ])
            : okAsync([]),
      })

      const result = await tool.execute({
        queries: ['ゲンキ プロテイン'],
        limit: 5,
      })

      expect(normalizeResult(result)).toEqual({
        ok: true,
        value: {
          candidates: [
            {
              food_master_id: 'fm_unrelated',
              composition_code: null,
              name: '無関係な商品',
              is_estimated: false,
              score: 1.2,
              reason: 'history_frequent',
              matched_queries: ['ゲンキ プロテイン'],
            },
          ],
        },
      })
      expect(calls).toEqual([
        { queries: ['ゲンキ プロテイン'], limit: 5 },
        { queries: ['ゲンキ', 'プロテイン'], limit: 5 },
      ])
    })

    it('returns the retry result as-is, without a third call, when it still has no usable candidate', async () => {
      const { tool, calls } = setup({
        search: (input) =>
          input.queries.includes('ゲンキ プロテイン')
            ? okAsync([
                {
                  reason: 'history_frequent',
                  score: 1.2,
                  nameSim: 0.42,
                  foodMasterId: 'fm_unrelated',
                  compositionCode: null,
                  name: '無関係な商品',
                  isEstimated: false,
                  matchedQueries: ['ゲンキ プロテイン'],
                },
              ])
            : okAsync([
                {
                  reason: 'fuzzy_name',
                  score: 0.3,
                  nameSim: 0.3,
                  foodMasterId: 'fm_weak',
                  compositionCode: null,
                  name: 'うすいマッチ',
                  isEstimated: false,
                  matchedQueries: ['ゲンキ'],
                },
              ]),
      })

      const result = await tool.execute({
        queries: ['ゲンキ プロテイン'],
        limit: 5,
      })

      expect(normalizeResult(result)).toEqual({
        ok: true,
        value: {
          candidates: [
            {
              food_master_id: 'fm_weak',
              composition_code: null,
              name: 'うすいマッチ',
              is_estimated: false,
              score: 0.3,
              reason: 'fuzzy_name',
              matched_queries: ['ゲンキ'],
            },
          ],
        },
      })
      expect(calls).toEqual([
        { queries: ['ゲンキ プロテイン'], limit: 5 },
        { queries: ['ゲンキ', 'プロテイン'], limit: 5 },
      ])
    })

    it('does not retry when the first call returns no candidates and no query has a new splittable token', async () => {
      const { tool, calls } = setup({ search: () => okAsync([]) })

      const result = await tool.execute({ queries: ['白米'], limit: 5 })

      expect(normalizeResult(result)).toEqual({
        ok: true,
        value: { candidates: [] },
      })
      expect(calls).toEqual([{ queries: ['白米'], limit: 5 }])
    })

    it('does not retry when the first call already returns candidates', async () => {
      const { tool, calls } = setup()

      await tool.execute({ queries: ['白米'], limit: 5 })

      expect(calls).toEqual([{ queries: ['白米'], limit: 5 }])
    })
  })
})
