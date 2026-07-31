import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  MealSkipNotFoundError,
  MealSkipPersistenceError,
} from '#domain/meal-skip/errors'
import type {
  CancelMealSkipInput,
  MealSkipService,
} from '#domain/meal-skip/meal-skip-service'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createCancelMealSkipTool } from '#llm/domain-tools/tools/cancel-meal-skip'

interface Calls {
  cancel: CancelMealSkipInput[]
}

const setup = (
  override: Partial<MealSkipService> = {},
): { tool: ReturnType<typeof createCancelMealSkipTool>; calls: Calls } => {
  const calls: Calls = { cancel: [] }
  const service: MealSkipService = {
    record: () =>
      errAsync(
        new MealSkipPersistenceError('mealSkipService.record not stubbed'),
      ),
    cancel: (input) => {
      calls.cancel.push(input)
      return okAsync(undefined)
    },
    findForDate: () => okAsync([]),
    ...override,
  }
  return { tool: createCancelMealSkipTool(service), calls }
}

describe('cancel_meal_skip tool', () => {
  it('bridges valid input to MealSkipService.cancel and returns the parsed date/meal_type', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      date: '2026-07-29',
      meal_type: 'breakfast',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: { date: '2026-07-29', meal_type: 'breakfast' },
    })
    expect(calls).toEqual({
      cancel: [{ date: '2026-07-29', mealType: 'breakfast' }],
    })
  })

  it('rejects an invalid date before reaching the service', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      date: '2026/07/29',
      meal_type: 'breakfast',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual({ cancel: [] })
  })

  it('rejects an invalid meal_type before reaching the service', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      date: '2026-07-29',
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
    expect(calls).toEqual({ cancel: [] })
  })

  it('maps a DomainError from MealSkipService.cancel to its code/message', async () => {
    const { tool, calls } = setup({
      cancel: () =>
        errAsync(new MealSkipNotFoundError('2026-07-29', 'breakfast')),
    })

    const result = await tool.execute({
      date: '2026-07-29',
      meal_type: 'breakfast',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_skip/not_found',
        message: '<dynamic>',
      },
    })
    expect(calls.cancel).toHaveLength(0)
  })
})
