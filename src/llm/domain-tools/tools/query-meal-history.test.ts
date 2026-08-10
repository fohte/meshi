import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type {
  MealHistoryAggregate,
  MealHistoryService,
  QueryMealHistoryInput,
} from '#domain/meal-history/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createQueryMealHistoryTool } from '#llm/domain-tools/tools/query-meal-history'
import { jstDate } from '#test/jst-date'

const AGGREGATE: MealHistoryAggregate = {
  totals: { energy_kcal: 1850 },
  perDay: [{ date: jstDate('2026-05-19'), totals: { energy_kcal: 1850 } }],
  entries: [
    {
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      foodName: 'ごはん',
      eatenDate: jstDate('2026-05-19'),
      mealType: 'lunch',
      quantity: 1,
    },
  ],
  hasEstimatedValues: true,
}

const setup = (): {
  tool: ReturnType<typeof createQueryMealHistoryTool>
  calls: QueryMealHistoryInput[]
} => {
  const calls: QueryMealHistoryInput[] = []
  const service: MealHistoryService = {
    query: (input) => {
      calls.push(input)
      return okAsync(AGGREGATE)
    },
  }
  return { tool: createQueryMealHistoryTool(service), calls }
}

describe('query_meal_history tool', () => {
  it('exposes the registered nutrient codes as a closed enum in nutrient_codes so the LLM never has to guess one', () => {
    const { tool } = setup()

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        period_from: {
          type: 'string',
        },
        period_to: {
          type: 'string',
        },
        food_master_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
        nutrient_codes: {
          type: 'array',
          items: { type: 'string', enum: [...NUTRIENT_CODES] },
        },
      },
      required: ['period_from', 'period_to'],
    })
  })

  it('bridges snake_case input to MealHistoryService.query and normalizes the response', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      period_from: '2026-05-01',
      period_to: '2026-05-20',
      food_master_ids: ['fm_rice'],
      nutrient_codes: ['energy_kcal'],
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        totals: { energy_kcal: 1850 },
        per_day: [{ date: '2026-05-19', totals: { energy_kcal: 1850 } }],
        entries: [
          {
            meal_log_id: 'ml_1',
            food_master_id: 'fm_rice',
            food_name: 'ごはん',
            eaten_date: '2026-05-19',
            meal_type: 'lunch',
            quantity: 1,
          },
        ],
        has_estimated_values: true,
      },
    })
    expect(calls).toEqual([
      {
        periodFrom: '2026-05-01',
        periodTo: '2026-05-20',
        foodFilter: ['fm_rice'],
        nutrientCodes: ['energy_kcal'],
      },
    ])
  })

  it('omits optional filters when not supplied', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      period_from: '2026-05-01',
      period_to: '2026-05-20',
    })

    expect(calls).toEqual([
      {
        periodFrom: '2026-05-01',
        periodTo: '2026-05-20',
      },
    ])
  })

  it('rejects non-ISO dates with invalid_input', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({
      period_from: 'not-a-date',
      period_to: '2026-05-20',
    })
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
