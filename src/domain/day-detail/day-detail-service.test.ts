import { errAsync, okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { createDayDetailService } from '#domain/day-detail/day-detail-service'
import type { MealHistoryService } from '#domain/meal-history/types'
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedFoodMaster, seedMealLog } from '#test/seed'

const stubNoSkips: MealSkipService = {
  record: () =>
    errAsync(
      new MealSkipPersistenceError('mealSkipService.record not stubbed'),
    ),
  cancel: () =>
    errAsync(
      new MealSkipPersistenceError('mealSkipService.cancel not stubbed'),
    ),
  findForDate: () => okAsync([]),
}

// createDayDetailService's own job is enriching MealHistoryService's entries
// with food_masters/meal_logs data it looks up itself (name, per-item kcal,
// estimated flag) — its aggregation (totals/hasEstimatedValues) is entirely
// MealHistoryService's responsibility and already covered by
// mealHistoryService.test.ts, and skippedMealTypes is entirely
// MealSkipService's responsibility and already covered by
// meal-skip-service.test.ts, so these tests stub both rather than composing
// the real implementations.
describeIfDb('DayDetailService.query', () => {
  const getTx = setupDrizzleTx()

  it('enriches entries with food name, per-item kcal, and the estimated flag', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'ごはん',
      source: 'user_input',
      nutrients: { energy_kcal: 156 },
    })
    await seedFoodMaster(tx, {
      id: 'mystery_stew',
      name: 'なぞのシチュー',
      isEstimated: true,
      source: 'user_input',
      nutrients: { energy_kcal: 200 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'breakfast',
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'dinner',
      quantity: 50,
    })

    const stubTotals = { energy_kcal: 412 }
    const mealHistoryService: MealHistoryService = {
      query: () =>
        okAsync({
          totals: stubTotals,
          perDay: [],
          hasEstimatedValues: true,
          entries: [
            {
              id: 'log-1',
              foodMasterId: 'rice',
              foodName: 'ごはん',
              eatenDate: jstDate('2026-06-01'),
              mealType: 'breakfast',
              quantity: 200,
            },
            {
              id: 'log-2',
              foodMasterId: 'mystery_stew',
              foodName: 'なぞのシチュー',
              eatenDate: jstDate('2026-06-01'),
              mealType: 'dinner',
              quantity: 50,
            },
          ],
        }),
    }
    const service = createDayDetailService(tx, mealHistoryService, stubNoSkips)

    const result = (
      await service.query({
        date: jstDate('2026-06-01'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: stubTotals,
      hasEstimatedValues: true,
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'ごはん',
          eatenDate: '2026-06-01',
          mealType: 'breakfast',
          quantity: 200,
          kcal: 31200,
          isEstimated: false,
        },
        {
          id: 'log-2',
          foodMasterId: 'mystery_stew',
          foodName: 'なぞのシチュー',
          eatenDate: '2026-06-01',
          mealType: 'dinner',
          quantity: 50,
          kcal: 10000,
          isEstimated: true,
        },
      ],
      skippedMealTypes: [],
    })
  })

  it('returns empty totals and entries when nothing was eaten in the period', async () => {
    const tx = getTx()
    const mealHistoryService: MealHistoryService = {
      query: () =>
        okAsync({
          totals: {},
          perDay: [],
          hasEstimatedValues: false,
          entries: [],
        }),
    }
    const service = createDayDetailService(tx, mealHistoryService, stubNoSkips)

    const result = (
      await service.query({
        date: jstDate('2026-06-01'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {},
      hasEstimatedValues: false,
      entries: [],
      skippedMealTypes: [],
    })
  })

  it('excludes a skipped meal type that already has a meal_log entry, but includes one that does not', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'ごはん',
      source: 'user_input',
      nutrients: { energy_kcal: 156 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenDate: jstDate('2026-06-01'),
      mealType: 'breakfast',
      quantity: 200,
    })

    const mealHistoryService: MealHistoryService = {
      query: () =>
        okAsync({
          totals: { energy_kcal: 312 },
          perDay: [],
          hasEstimatedValues: false,
          entries: [
            {
              id: 'log-1',
              foodMasterId: 'rice',
              foodName: 'ごはん',
              eatenDate: jstDate('2026-06-01'),
              mealType: 'breakfast',
              quantity: 200,
            },
          ],
        }),
    }
    const mealSkipService: MealSkipService = {
      ...stubNoSkips,
      findForDate: () =>
        okAsync([
          {
            id: 'skip-breakfast',
            date: jstDate('2026-06-01'),
            mealType: 'breakfast',
            createdAt: new Date('2026-06-01T00:00:00Z'),
          },
          {
            id: 'skip-lunch',
            date: jstDate('2026-06-01'),
            mealType: 'lunch',
            createdAt: new Date('2026-06-01T00:00:00Z'),
          },
        ]),
    }
    const service = createDayDetailService(
      tx,
      mealHistoryService,
      mealSkipService,
    )

    const result = (
      await service.query({
        date: jstDate('2026-06-01'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { energy_kcal: 312 },
      hasEstimatedValues: false,
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'ごはん',
          eatenDate: '2026-06-01',
          mealType: 'breakfast',
          quantity: 200,
          kcal: 31200,
          isEstimated: false,
        },
      ],
      skippedMealTypes: ['lunch'],
    })
  })
})
