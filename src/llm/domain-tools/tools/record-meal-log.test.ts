import { describe, expect, it } from 'vitest'

import {
  FoodMasterNotFoundError,
  FutureEatenAtError,
} from '@/domain/meal-log/errors'
import type { MealLogService } from '@/domain/meal-log/meal-log-service'
import type { MealLogResult, RecordMealLogInput } from '@/domain/meal-log/types'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createRecordMealLogTool } from '@/llm/domain-tools/tools/record-meal-log'

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
        quantity: input.quantity,
        unit: input.unit,
        note: input.note ?? null,
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        nutrition: { energy_kcal: 252 },
        isEstimated: false,
      }
      return Promise.resolve(result)
    },
    getById: () => Promise.resolve(null),
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

    expect({ result: normalizeResult(result), calls }).toEqual({
      result: {
        ok: true,
        value: {
          meal_log_id: 'ml_1',
          nutrition: { energy_kcal: 252 },
          is_estimated: false,
        },
      },
      calls: {
        record: [
          {
            foodMasterId: 'fm_rice',
            eatenAt: new Date('2026-06-18T09:00:00+09:00'),
            quantity: 1,
            unit: '杯',
            note: 'lunch',
          },
        ],
      },
    })
  })

  it('returns invalid_input when required fields are missing', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 1,
      unit: '杯',
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
      calls: { record: [] },
    })
  })

  it('returns invalid_input for non-positive quantity', async () => {
    const { tool, calls } = setup()
    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2026-06-18T09:00:00+09:00',
      quantity: 0,
      unit: '杯',
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
      calls: { record: [] },
    })
  })

  it('maps FutureEatenAtError to its DomainError code', async () => {
    const eatenAt = new Date('2099-01-01T00:00:00.000Z')
    const { tool, calls } = setup({
      record: () => Promise.reject(new FutureEatenAtError(eatenAt)),
    })

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      eaten_at_iso: '2099-01-01T00:00:00+00:00',
      quantity: 1,
      unit: '杯',
    })

    expect({
      result: normalizeResult(result),
      recordCalled: calls.record.length,
    }).toEqual({
      result: {
        ok: false,
        error: {
          code: 'meal_log/future_eaten_at',
          message: '<dynamic>',
        },
      },
      recordCalled: 0,
    })
  })

  it('maps FoodMasterNotFoundError to its DomainError code', async () => {
    const { tool } = setup({
      record: () => Promise.reject(new FoodMasterNotFoundError('fm_missing')),
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
  })
})
