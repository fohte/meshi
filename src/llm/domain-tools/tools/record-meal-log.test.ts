import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  FoodMasterNotFoundError,
  FutureEatenAtError,
  ImplausibleQuantityError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult, RecordMealLogInput } from '#domain/meal-log/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRecordMealLogTool } from '#llm/domain-tools/tools/record-meal-log'

interface Calls {
  record: RecordMealLogInput[]
}

const setup = (
  override: Partial<MealLogService> = {},
): { tool: ReturnType<typeof createRecordMealLogTool>; calls: Calls } => {
  const calls: Calls = { record: [] }
  const service: MealLogService = {
    record: (input) => {
      calls.record.push(input)
      const result: MealLogResult = {
        id: 'ml_1',
        foodMasterId: input.foodMasterId,
        eatenAt: input.eatenAt,
        mealType: input.mealType ?? 'lunch',
        quantity: input.quantity,
        unit: input.unit,
        note: input.note ?? null,
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        nutrition: { energy_kcal: 252 },
        isEstimated: false,
      }
      return okAsync(result)
    },
    getById: () => okAsync(null),
    ...override,
  }
  return { tool: createRecordMealLogTool(service), calls }
}

describe('record_meal_log tool', () => {
  it('bridges valid input to MealLogService.record and returns the meal_log_id + nutrition', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 1,
      unit: '杯',
      note: 'lunch',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        meal_log_id: 'ml_1',
        nutrition: { energy_kcal: 252 },
        is_estimated: false,
      },
    })
    expect(calls).toEqual({
      record: [
        {
          foodMasterId: 'fm_rice',
          eatenAt: new Date('2026-06-18T09:00:00+09:00'),
          quantity: 1,
          unit: '杯',
          note: 'lunch',
        },
      ],
    })
  })

  it('passes meal_type through when provided', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      meal_type: 'breakfast',
      quantity: 1,
      unit: '杯',
    })

    expect(calls).toEqual({
      record: [
        {
          foodMasterId: 'fm_rice',
          eatenAt: new Date('2026-06-18T09:00:00+09:00'),
          mealType: 'breakfast',
          quantity: 1,
          unit: '杯',
        },
      ],
    })
  })

  it('rejects an invalid meal_type value with invalid_input', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      meal_type: 'brunch',
      quantity: 1,
      unit: '杯',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ record: [] })
  })

  it('returns invalid_input when required fields are missing', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 1,
      unit: '杯',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ record: [] })
  })

  it('returns invalid_input for non-positive quantity', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 0,
      unit: '杯',
    })
    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ record: [] })
  })

  it('maps FutureEatenAtError to its DomainError code', async () => {
    const eatenAt = new Date('2099-01-01T00:00:00.000Z')
    const { tool, calls } = setup({
      record: () => errAsync(new FutureEatenAtError(eatenAt)),
    })

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2099-01-01T00:00:00+00:00',
      quantity: 1,
      unit: '杯',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/future_eaten_at',
        message: '<dynamic>',
      },
    })
    expect(calls.record).toHaveLength(0)
  })

  it('maps ImplausibleQuantityError to its DomainError code', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new ImplausibleQuantityError(101, '個', 101)),
    })

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 101,
      unit: '個',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/implausible_quantity',
        message: '<dynamic>',
      },
    })
    expect(calls.record).toHaveLength(0)
  })

  it('exposes the unit-scaling rule in the JSON Schema so the LLM knows how ml/kg/etc. are interpreted', () => {
    const { tool } = setup()

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        food_master_id: { type: 'string', minLength: 1 },
        eaten_at_iso: {
          type: 'string',
          format: 'date-time',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d(?::[0-5]\\d(?:\\.\\d+)?)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$',
        },
        meal_type: {
          type: 'string',
          enum: ['breakfast', 'lunch', 'dinner', 'snack'],
        },
        quantity: { type: 'number', exclusiveMinimum: 0 },
        unit: {
          type: 'string',
          minLength: 1,
          description:
            "Unit for quantity. Continuous mass/volume units (g, kg, mg, ml, l, cc) scale food_master's per-100g nutrition linearly — e.g. 600 'ml' scales ×6, not ×600. Any other unit (e.g. 杯, 個, 枚) is treated as one whole serving: quantity multiplies the per-100g values directly, so only use it when one unit is roughly a single 100g-equivalent portion.",
        },
        note: { type: 'string' },
      },
      required: ['food_master_id', 'eaten_at_iso', 'quantity', 'unit'],
    })
  })

  it('maps FoodMasterNotFoundError to its DomainError code', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new FoodMasterNotFoundError('fm_missing')),
    })

    const result = await tool.execute({
      food_master_id: 'fm_missing',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 1,
      unit: 'g',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/food_master_not_found',
        message: '<dynamic>',
      },
    })
    expect(calls).toEqual({ record: [] })
  })
})
