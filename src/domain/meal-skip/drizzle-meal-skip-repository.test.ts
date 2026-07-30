import { describe, expect, it } from 'vitest'

import { createDrizzleMealSkipRepository } from '#domain/meal-skip/drizzle-meal-skip-repository'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'

const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const normalizeRow = (row: MealSkipRow): MealSkipRow => ({
  ...row,
  createdAt: CREATED_AT_PLACEHOLDER,
})

describeIfDb('DrizzleMealSkipRepository', () => {
  const getTx = setupDrizzleTx()

  describe('recordSkip', () => {
    it('inserts a fresh row', async () => {
      const tx = getTx()
      const repository = createDrizzleMealSkipRepository(tx)

      const result = (
        await repository.recordSkip({
          id: 'skip_1',
          date: '2026-07-29',
          mealType: 'breakfast',
        })
      )._unsafeUnwrap()

      expect(normalizeRow(result)).toEqual({
        id: 'skip_1',
        date: '2026-07-29',
        mealType: 'breakfast',
        createdAt: CREATED_AT_PLACEHOLDER,
      })
    })

    it('is idempotent when called twice for the same date and meal type', async () => {
      const tx = getTx()
      const repository = createDrizzleMealSkipRepository(tx)

      const first = (
        await repository.recordSkip({
          id: 'skip_1',
          date: '2026-07-29',
          mealType: 'lunch',
        })
      )._unsafeUnwrap()
      const second = (
        await repository.recordSkip({
          id: 'skip_2',
          date: '2026-07-29',
          mealType: 'lunch',
        })
      )._unsafeUnwrap()

      expect(second).toEqual(first)

      const all = (
        await repository.findSkipsForDate('2026-07-29')
      )._unsafeUnwrap()
      expect(all.map(normalizeRow)).toEqual([normalizeRow(first)])
    })
  })

  describe('cancelSkip', () => {
    it('returns true and deletes the row when a skip existed', async () => {
      const tx = getTx()
      const repository = createDrizzleMealSkipRepository(tx)
      await repository.recordSkip({
        id: 'skip_1',
        date: '2026-07-29',
        mealType: 'dinner',
      })

      const deleted = (
        await repository.cancelSkip('2026-07-29', 'dinner')
      )._unsafeUnwrap()
      expect(deleted).toBe(true)

      const remaining = (
        await repository.findSkipsForDate('2026-07-29')
      )._unsafeUnwrap()
      expect(remaining).toEqual([])
    })

    it('returns false when no skip existed', async () => {
      const tx = getTx()
      const repository = createDrizzleMealSkipRepository(tx)

      const deleted = (
        await repository.cancelSkip('2026-07-29', 'snack')
      )._unsafeUnwrap()

      expect(deleted).toBe(false)
    })
  })

  describe('findSkipsForDate', () => {
    it('returns only rows for the given date', async () => {
      const tx = getTx()
      const repository = createDrizzleMealSkipRepository(tx)
      const seeded = (
        await repository.recordSkip({
          id: 'skip_1',
          date: '2026-07-29',
          mealType: 'breakfast',
        })
      )._unsafeUnwrap()
      await repository.recordSkip({
        id: 'skip_2',
        date: '2026-07-30',
        mealType: 'breakfast',
      })

      const result = (
        await repository.findSkipsForDate('2026-07-29')
      )._unsafeUnwrap()

      expect(result.map(normalizeRow)).toEqual([normalizeRow(seeded)])
    })
  })
})
