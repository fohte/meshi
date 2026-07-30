import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  FutureMealSkipDateError,
  MealSkipPersistenceError,
} from '#domain/meal-skip/errors'
import type {
  MealSkipService,
  RecordMealSkipInput,
} from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRecordMealSkipTool } from '#llm/domain-tools/tools/record-meal-skip'

interface Calls {
  record: RecordMealSkipInput[]
}

const SAMPLE_ROW: MealSkipRow = {
  id: 'skip_1',
  date: '2026-07-29',
  mealType: 'breakfast',
  createdAt: new Date('2026-07-29T00:00:00.000Z'),
}

const setup = (
  override: Partial<MealSkipService> = {},
): { tool: ReturnType<typeof createRecordMealSkipTool>; calls: Calls } => {
  const calls: Calls = { record: [] }
  const service: MealSkipService = {
    record: (input) => {
      calls.record.push(input)
      return okAsync(SAMPLE_ROW)
    },
    cancel: () =>
      errAsync(
        new MealSkipPersistenceError('mealSkipService.cancel not stubbed'),
      ),
    findForDate: () => okAsync([]),
    ...override,
  }
  return { tool: createRecordMealSkipTool(service), calls }
}

describe('record_meal_skip tool', () => {
  it('bridges valid input to MealSkipService.record and returns the mapped result', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      date: '2026-07-29',
      meal_type: 'breakfast',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        meal_skip_id: 'skip_1',
        date: '2026-07-29',
        meal_type: 'breakfast',
      },
    })
    expect(calls).toEqual({
      record: [{ date: '2026-07-29', mealType: 'breakfast' }],
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
    expect(calls).toEqual({ record: [] })
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
    expect(calls).toEqual({ record: [] })
  })

  it('maps a DomainError from MealSkipService.record to its code/message', async () => {
    const { tool, calls } = setup({
      record: () => errAsync(new FutureMealSkipDateError('2099-01-01')),
    })

    const result = await tool.execute({
      date: '2099-01-01',
      meal_type: 'breakfast',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'meal_skip/future_date',
        message: '<dynamic>',
      },
    })
    expect(calls.record).toHaveLength(0)
  })
})
