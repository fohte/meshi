import { describe, expect, it } from 'vitest'

import type {
  MealHistoryAggregate,
  MealHistoryService,
  QueryMealHistoryInput,
} from '@/domain/meal-history/types'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createQueryMealHistoryTool } from '@/llm/domain-tools/tools/query-meal-history'

const AGGREGATE: MealHistoryAggregate = {
  totals: { energy_kcal: 1850 },
  perDay: [{ date: '2026-05-19', totals: { energy_kcal: 1850 } }],
  entries: [
    {
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: new Date('2026-05-19T03:00:00.000Z'),
      quantity: 1,
      unit: '杯',
      note: null,
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
      return Promise.resolve(AGGREGATE)
    },
  }
  return { tool: createQueryMealHistoryTool(service), calls }
}

describe('query_meal_history tool', () => {
  it('bridges snake_case input to MealHistoryService.query and normalizes the response', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      period_from_iso: '2026-05-01T00:00:00+09:00',
      period_to_iso: '2026-05-20T00:00:00+09:00',
      food_master_ids: ['fm_rice'],
      nutrient_codes: ['energy_kcal'],
    })

    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: true,
        value: {
          totals: { energy_kcal: 1850 },
          per_day: [{ date: '2026-05-19', totals: { energy_kcal: 1850 } }],
          entries: [
            {
              meal_log_id: 'ml_1',
              food_master_id: 'fm_rice',
              eaten_at_iso: '2026-05-19T03:00:00.000Z',
              quantity: 1,
              unit: '杯',
              note: null,
            },
          ],
          has_estimated_values: true,
        },
      },
      calls: [
        {
          periodFrom: new Date('2026-05-01T00:00:00+09:00'),
          periodTo: new Date('2026-05-20T00:00:00+09:00'),
          foodFilter: ['fm_rice'],
          nutrientCodes: ['energy_kcal'],
        },
      ],
    })
  })

  it('omits optional filters when not supplied', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      period_from_iso: '2026-05-01T00:00:00+09:00',
      period_to_iso: '2026-05-20T00:00:00+09:00',
    })

    expect(calls).toEqual([
      {
        periodFrom: new Date('2026-05-01T00:00:00+09:00'),
        periodTo: new Date('2026-05-20T00:00:00+09:00'),
      },
    ])
  })

  it('rejects non-ISO dates with invalid_input', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({
      period_from_iso: 'not-a-date',
      period_to_iso: '2026-05-20T00:00:00+09:00',
    })
    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: '<dynamic>',
          details: { issues: { count: 1 } },
        },
      },
      calls: [],
    })
  })
})
