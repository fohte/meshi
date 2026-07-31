import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  FutureMealSkipDateError,
  InvalidMealSkipDateError,
  MealSkipNotFoundError,
} from '#domain/meal-skip/errors'
import type { MealSkipRepository } from '#domain/meal-skip/meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'

const NOW = new Date('2026-07-30T00:00:00+09:00')
const CREATED_AT = new Date('2026-07-30T00:00:00.500Z')

const skipKey = (date: string, mealType: MealType): string =>
  `${date}:${mealType}`

// Mirrors DrizzleMealSkipRepository's upsert semantics (keeps the
// pre-existing row, including its original id, on a repeat recordSkip).
const createFakeRepository = (): {
  repository: MealSkipRepository
  rows: Map<string, MealSkipRow>
} => {
  const rows = new Map<string, MealSkipRow>()
  const repository: MealSkipRepository = {
    recordSkip: (input) => {
      const key = skipKey(input.date, input.mealType)
      const existing = rows.get(key)
      if (existing !== undefined) return okAsync(existing)
      const row: MealSkipRow = {
        id: input.id,
        date: input.date,
        mealType: input.mealType,
        createdAt: CREATED_AT,
      }
      rows.set(key, row)
      return okAsync(row)
    },
    cancelSkip: (date, mealType) =>
      okAsync(rows.delete(skipKey(date, mealType))),
    findSkipsForDate: (date) =>
      okAsync(Array.from(rows.values()).filter((row) => row.date === date)),
  }
  return { repository, rows }
}

const buildService = () => {
  const { repository, rows } = createFakeRepository()
  const ids = ['skip_1', 'skip_2', 'skip_3']
  let idx = 0
  const service = createMealSkipService({
    repository,
    idGenerator: () => ids[idx++] ?? 'skip_overflow',
    now: () => NOW,
  })
  return { service, rows }
}

describe('MealSkipService.record', () => {
  it('rejects an invalid date format', async () => {
    const { service } = buildService()

    const result = await service.record({
      date: '2026/07/29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new InvalidMealSkipDateError('2026/07/29'),
    )
  })

  it('rejects a future date', async () => {
    const { service } = buildService()

    const result = await service.record({
      date: '2026-07-31',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new FutureMealSkipDateError('2026-07-31'),
    )
  })

  it('forwards a generated id to the repository for a valid past date', async () => {
    const { service, rows } = buildService()

    const result = await service.record({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrap()).toEqual({
      id: 'skip_1',
      date: '2026-07-29',
      mealType: 'breakfast',
      createdAt: CREATED_AT,
    })
    expect(rows.get('2026-07-29:breakfast')).toEqual({
      id: 'skip_1',
      date: '2026-07-29',
      mealType: 'breakfast',
      createdAt: CREATED_AT,
    })
  })

  it('succeeds for a date equal to today', async () => {
    const { service, rows } = buildService()

    const result = await service.record({
      date: '2026-07-30',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrap()).toEqual({
      id: 'skip_1',
      date: '2026-07-30',
      mealType: 'breakfast',
      createdAt: CREATED_AT,
    })
    expect(rows.get('2026-07-30:breakfast')).toEqual({
      id: 'skip_1',
      date: '2026-07-30',
      mealType: 'breakfast',
      createdAt: CREATED_AT,
    })
  })
})

describe('MealSkipService.cancel', () => {
  it('rejects an invalid date format', async () => {
    const { service } = buildService()

    const result = await service.cancel({
      date: '2026/07/29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new InvalidMealSkipDateError('2026/07/29'),
    )
  })

  it('returns MealSkipNotFoundError when no skip is recorded for that date and mealType', async () => {
    const { service } = buildService()

    const result = await service.cancel({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result._unsafeUnwrapErr()).toEqual(
      new MealSkipNotFoundError('2026-07-29', 'breakfast'),
    )
  })

  it('succeeds and removes the row when a skip was previously recorded', async () => {
    const { service, rows } = buildService()
    await service.record({ date: '2026-07-29', mealType: 'breakfast' })

    const result = await service.cancel({
      date: '2026-07-29',
      mealType: 'breakfast',
    })

    expect(result.isOk()).toBe(true)
    expect(rows.has('2026-07-29:breakfast')).toBe(false)
  })
})

describe('MealSkipService.findForDate', () => {
  it('returns skips previously recorded for that date, excluding other dates', async () => {
    const { service } = buildService()
    await service.record({ date: '2026-07-29', mealType: 'breakfast' })
    await service.record({ date: '2026-07-30', mealType: 'dinner' })

    const result = await service.findForDate('2026-07-29')

    expect(result._unsafeUnwrap()).toEqual([
      {
        id: 'skip_1',
        date: '2026-07-29',
        mealType: 'breakfast',
        createdAt: CREATED_AT,
      },
    ])
  })
})
