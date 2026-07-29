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

const AGGREGATE: MealHistoryAggregate = {
  totals: { energy_kcal: 1850 },
  perDay: [{ date: '2026-05-19', totals: { energy_kcal: 1850 } }],
  entries: [
    {
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      foodName: 'ごはん',
      eatenAt: new Date('2026-05-19T03:00:00.000Z'),
      mealType: 'lunch',
      quantity: 1,
      unit: '杯',
      note: null,
    },
  ],
  hasEstimatedValues: true,
}

// The exact pattern zod's z.iso.datetime({ offset: true }) emits via
// z.toJSONSchema — pinned here (rather than matched loosely) so the schema
// equality check below covers the whole LLM-facing input shape in one
// assertion, per this repo's test-philosophy.
const ISO_DATETIME_PATTERN =
  '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$'

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
        period_from_iso: {
          type: 'string',
          format: 'date-time',
          pattern: ISO_DATETIME_PATTERN,
        },
        period_to_iso: {
          type: 'string',
          format: 'date-time',
          pattern: ISO_DATETIME_PATTERN,
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
      required: ['period_from_iso', 'period_to_iso'],
    })
  })

  it('bridges snake_case input to MealHistoryService.query and normalizes the response', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      period_from_iso: '2026-05-01T00:00:00+09:00',
      period_to_iso: '2026-05-20T00:00:00+09:00',
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
            eaten_at_iso: '2026-05-19T03:00:00.000Z',
            meal_type: 'lunch',
            quantity: 1,
            unit: '杯',
            note: null,
          },
        ],
        has_estimated_values: true,
      },
    })
    expect(calls).toEqual([
      {
        periodFrom: new Date('2026-05-01T00:00:00+09:00'),
        periodTo: new Date('2026-05-20T00:00:00+09:00'),
        foodFilter: ['fm_rice'],
        nutrientCodes: ['energy_kcal'],
      },
    ])
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
