import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  FutureMealSkipDateError,
  InvalidMealSkipDateError,
  MealSkipNotFoundError,
  MealSkipPersistenceError,
} from '#domain/meal-skip/errors'
import type {
  InsertMealSkipInput,
  MealSkipRepository,
} from '#domain/meal-skip/meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'

const NOW = new Date('2026-07-30T00:00:00+09:00')

const SAMPLE_ROW: MealSkipRow = {
  id: 'skip_1',
  date: '2026-07-29',
  mealType: 'breakfast',
  createdAt: new Date('2026-07-29T00:00:00Z'),
}

const notStubbed = (name: string): MealSkipRepository => ({
  recordSkip: () =>
    errAsync(new MealSkipPersistenceError(`${name}.recordSkip not stubbed`)),
  cancelSkip: () =>
    errAsync(new MealSkipPersistenceError(`${name}.cancelSkip not stubbed`)),
  findSkipsForDate: () =>
    errAsync(
      new MealSkipPersistenceError(`${name}.findSkipsForDate not stubbed`),
    ),
})

describe('MealSkipService.record', () => {
  it('rejects an invalid date format', async () => {
    const service = createMealSkipService({
      repository: notStubbed('repository'),
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.record({
      date: '2026/07/29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new InvalidMealSkipDateError('2026/07/29'),
    )
  })

  it('rejects a future date', async () => {
    const service = createMealSkipService({
      repository: notStubbed('repository'),
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.record({
      date: '2026-07-31',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new FutureMealSkipDateError('2026-07-31'),
    )
  })

  it('forwards a generated id to the repository for a valid past date', async () => {
    let captured: InsertMealSkipInput | undefined
    const service = createMealSkipService({
      repository: {
        ...notStubbed('repository'),
        recordSkip: (input) => {
          captured = input
          return okAsync(SAMPLE_ROW)
        },
      },
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.record({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrap()).toEqual(SAMPLE_ROW)
    expect(captured).toEqual({
      id: 'skip_1',
      date: '2026-07-29',
      mealType: 'breakfast',
    })
  })

  it('succeeds for a date equal to today', async () => {
    let captured: InsertMealSkipInput | undefined
    const service = createMealSkipService({
      repository: {
        ...notStubbed('repository'),
        recordSkip: (input) => {
          captured = input
          return okAsync(SAMPLE_ROW)
        },
      },
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.record({
      date: '2026-07-30',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrap()).toEqual(SAMPLE_ROW)
    expect(captured).toEqual({
      id: 'skip_1',
      date: '2026-07-30',
      mealType: 'breakfast',
    })
  })
})

describe('MealSkipService.cancel', () => {
  it('rejects an invalid date format', async () => {
    const service = createMealSkipService({
      repository: notStubbed('repository'),
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.cancel({
      date: '2026/07/29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new InvalidMealSkipDateError('2026/07/29'),
    )
  })

  it('returns MealSkipNotFoundError when the repository resolves false', async () => {
    const service = createMealSkipService({
      repository: {
        ...notStubbed('repository'),
        cancelSkip: () => okAsync(false),
      },
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.cancel({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new MealSkipNotFoundError('2026-07-29', 'breakfast'),
    )
  })

  it('succeeds when the repository resolves true', async () => {
    let captured: readonly [string, MealType] | undefined
    const service = createMealSkipService({
      repository: {
        ...notStubbed('repository'),
        cancelSkip: (date, mealType) => {
          captured = [date, mealType]
          return okAsync(true)
        },
      },
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.cancel({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result.isOk()).toBe(true)
    expect(captured).toEqual(['2026-07-29', 'breakfast'])
  })
})

describe('MealSkipService.findForDate', () => {
  it('passes through the repository result', async () => {
    const service = createMealSkipService({
      repository: {
        ...notStubbed('repository'),
        findSkipsForDate: () => okAsync([SAMPLE_ROW]),
      },
      idGenerator: () => 'skip_1',
      now: () => NOW,
    })

    const result = await service.findForDate('2026-07-29')

    expect(result._unsafeUnwrap()).toEqual([SAMPLE_ROW])
  })
})
