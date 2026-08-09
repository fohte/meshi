import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  DomainError,
  FoodMasterNotFoundError,
  FoodNameMismatchError,
  FutureEatenDateError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult, RecordMealLogInput } from '#domain/meal-log/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRecordMealLogTool } from '#llm/domain-tools/tools/record-meal-log'
import { jstDate } from '#test/jst-date'

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
        eatenDate: input.eatenDate,
        mealType: input.mealType,
        quantity: input.quantity,
        unit: input.unit,
        amountGrams: input.quantity,
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        nutrition: { energy_kcal: 252 },
        isEstimated: false,
      }
      return okAsync(result)
    },
    update: () =>
      errAsync(
        new DomainError(
          'mealLogService.update not stubbed',
          'test/not_stubbed',
        ),
      ),
    getById: () => okAsync(null),
    delete: () =>
      errAsync(
        new DomainError(
          'mealLogService.delete not stubbed',
          'test/not_stubbed',
        ),
      ),
    ...override,
  }
  return { tool: createRecordMealLogTool(service), calls }
}

describe('record_meal_log tool', () => {
  it('bridges valid input to MealLogService.record and returns the meal_log_id + nutrition', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      food_name: '白米',
      date: '2026-06-18',
      meal_type: 'breakfast',
      quantity: 1,
      unit: '杯',
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
          foodName: '白米',
          eatenDate: '2026-06-18',
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
      food_name: '白米',
      date: '2026-06-18',
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

  it('returns invalid_input when meal_type is missing', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      food_name: '白米',
      date: '2026-06-18',
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
      food_name: '白米',
      date: '2026-06-18',
      meal_type: 'breakfast',
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

  it('returns invalid_input when food_name is missing', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      date: '2026-06-18',
      meal_type: 'breakfast',
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

  it('returns invalid_input when food_name is whitespace-only', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      food_name: '   ',
      date: '2026-06-18',
      meal_type: 'breakfast',
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
      food_name: '白米',
      date: '2026-06-18',
      meal_type: 'breakfast',
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

  it('maps FutureEatenDateError to its DomainError code', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new FutureEatenDateError(jstDate('2099-01-01'))),
    })

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      food_name: '白米',
      date: '2099-01-01',
      meal_type: 'breakfast',
      quantity: 1,
      unit: '杯',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/future_eaten_date',
        message: '<dynamic>',
      },
    })
    expect(calls.record).toHaveLength(0)
  })

  it('maps FoodMasterNotFoundError to its DomainError code', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new FoodMasterNotFoundError('fm_missing')),
    })

    const result = await tool.execute({
      food_master_id: 'fm_missing',
      food_name: '白米',
      date: '2026-06-18',
      meal_type: 'breakfast',
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

  it('maps FoodNameMismatchError to its DomainError code', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new FoodNameMismatchError('唐揚げ', '白米')),
    })

    const result = await tool.execute({
      food_master_id: 'fm_rice',
      food_name: '唐揚げ',
      date: '2026-06-18',
      meal_type: 'breakfast',
      quantity: 1,
      unit: 'g',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/food_name_mismatch',
        message: '<dynamic>',
      },
    })
    expect(calls).toEqual({ record: [] })
  })
})
