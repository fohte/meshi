import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  DomainError,
  FoodMasterNotFoundError,
  FutureEatenDateError,
  MealLogNotFoundError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult, UpdateMealLogInput } from '#domain/meal-log/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createUpdateMealLogTool } from '#llm/domain-tools/tools/update-meal-log'

interface Calls {
  update: UpdateMealLogInput[]
}

const setup = (
  override: Partial<MealLogService> = {},
): { tool: ReturnType<typeof createUpdateMealLogTool>; calls: Calls } => {
  const calls: Calls = { update: [] }
  const service: MealLogService = {
    record: () =>
      errAsync(
        new DomainError(
          'mealLogService.record not stubbed',
          'test/not_stubbed',
        ),
      ),
    update: (input) => {
      calls.update.push(input)
      const result: MealLogResult = {
        id: input.id,
        foodMasterId: input.foodMasterId ?? 'fm_rice',
        eatenDate: input.eatenDate ?? '2026-06-18',
        mealType: input.mealType ?? 'lunch',
        quantity: input.quantity ?? 100,
        unit: input.unit ?? 'g',
        amountGrams: input.quantity ?? 100,
        createdAt: new Date('2026-06-18T00:00:00.000Z'),
        nutrition: { energy_kcal: 312 },
        isEstimated: false,
      }
      return okAsync(result)
    },
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
  return { tool: createUpdateMealLogTool(service), calls }
}

describe('update_meal_log tool', () => {
  it('bridges a full patch to MealLogService.update and returns the meal_log_id + nutrition', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      meal_log_id: 'ml_1',
      food_master_id: 'fm_karaage',
      date: '2026-06-18',
      meal_type: 'breakfast',
      quantity: 200,
      unit: 'g',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        meal_log_id: 'ml_1',
        nutrition: { energy_kcal: 312 },
        is_estimated: false,
      },
    })
    expect(calls).toEqual({
      update: [
        {
          id: 'ml_1',
          foodMasterId: 'fm_karaage',
          eatenDate: '2026-06-18',
          mealType: 'breakfast',
          quantity: 200,
          unit: 'g',
        },
      ],
    })
  })

  it('forwards only the provided fields, omitting the rest from the patch', async () => {
    const { tool, calls } = setup()

    await tool.execute({ meal_log_id: 'ml_1', quantity: 250 })

    expect(calls).toEqual({
      update: [{ id: 'ml_1', quantity: 250 }],
    })
  })

  it('rejects a patch with no field to update besides meal_log_id', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ meal_log_id: 'ml_1' })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('rejects an invalid meal_type value with invalid_input', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      meal_log_id: 'ml_1',
      meal_type: 'brunch',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('returns invalid_input when meal_log_id is missing', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ quantity: 100 })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('returns invalid_input for non-positive quantity', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ meal_log_id: 'ml_1', quantity: 0 })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('maps MealLogNotFoundError to its DomainError code', async () => {
    const { tool, calls } = setup({
      update: () => errAsync(new MealLogNotFoundError('ml_missing')),
    })

    const result = await tool.execute({
      meal_log_id: 'ml_missing',
      quantity: 100,
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/not_found',
        message: '<dynamic>',
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('maps FutureEatenDateError to its DomainError code', async () => {
    const { tool, calls } = setup({
      update: () => errAsync(new FutureEatenDateError('2099-01-01')),
    })

    const result = await tool.execute({
      meal_log_id: 'ml_1',
      date: '2099-01-01',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/future_eaten_date',
        message: '<dynamic>',
      },
    })
    expect(calls).toEqual({ update: [] })
  })

  it('maps FoodMasterNotFoundError to its DomainError code', async () => {
    const { tool, calls } = setup({
      update: () => errAsync(new FoodMasterNotFoundError('fm_missing')),
    })

    const result = await tool.execute({
      meal_log_id: 'ml_1',
      food_master_id: 'fm_missing',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_log/food_master_not_found',
        message: '<dynamic>',
      },
    })
    expect(calls).toEqual({ update: [] })
  })
})
