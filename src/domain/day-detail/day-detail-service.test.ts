import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { createDayDetailService } from '#domain/day-detail/day-detail-service'
import type { MealHistoryService } from '#domain/meal-history/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMaster, seedMealLog } from '#test/seed'

// createDayDetailService's own job is enriching MealHistoryService's entries
// with food_masters/meal_logs data it looks up itself (name, per-item kcal,
// estimated flag) — its aggregation (totals/hasEstimatedValues) is entirely
// MealHistoryService's responsibility and already covered by
// mealHistoryService.test.ts, so these tests stub MealHistoryService rather
// than composing the real implementation.
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
      source: 'composition_table_estimate',
      nutrients: { energy_kcal: 200 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T00:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenAt: new Date('2026-06-01T09:00:00Z'),
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
              eatenAt: new Date('2026-06-01T00:00:00Z'),
              mealType: 'breakfast',
              quantity: 200,
              unit: 'g',
              note: null,
            },
            {
              id: 'log-2',
              foodMasterId: 'mystery_stew',
              eatenAt: new Date('2026-06-01T09:00:00Z'),
              mealType: 'dinner',
              quantity: 50,
              unit: 'g',
              note: null,
            },
          ],
        }),
    }
    const service = createDayDetailService(tx, mealHistoryService)

    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
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
          eatenAt: new Date('2026-06-01T00:00:00Z'),
          mealType: 'breakfast',
          quantity: 200,
          unit: 'g',
          note: null,
          kcal: 312,
          isEstimated: false,
        },
        {
          id: 'log-2',
          foodMasterId: 'mystery_stew',
          foodName: 'なぞのシチュー',
          eatenAt: new Date('2026-06-01T09:00:00Z'),
          mealType: 'dinner',
          quantity: 50,
          unit: 'g',
          note: null,
          kcal: 100,
          isEstimated: true,
        },
      ],
    })
  })

  it('computes per-item kcal from amount_grams, not the display quantity', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'たまご',
      source: 'user_input',
      nutrients: { energy_kcal: 151 },
    })
    // 2 個 at 55g/個 resolves to 110g — quantity alone (2) would give the
    // wrong kcal if this read quantity directly instead of amount_grams.
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T00:00:00Z'),
      quantity: 2,
      unit: '個',
      amountGrams: 110,
    })

    const mealHistoryService: MealHistoryService = {
      query: () =>
        okAsync({
          totals: {},
          perDay: [],
          hasEstimatedValues: false,
          entries: [
            {
              id: 'log-1',
              foodMasterId: 'egg',
              eatenAt: new Date('2026-06-01T00:00:00Z'),
              mealType: 'breakfast',
              quantity: 2,
              unit: '個',
              note: null,
            },
          ],
        }),
    }
    const service = createDayDetailService(tx, mealHistoryService)

    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {},
      hasEstimatedValues: false,
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'egg',
          foodName: 'たまご',
          eatenAt: new Date('2026-06-01T00:00:00Z'),
          mealType: 'breakfast',
          quantity: 2,
          unit: '個',
          note: null,
          kcal: (151 * 110) / 100,
          isEstimated: false,
        },
      ],
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
    const service = createDayDetailService(tx, mealHistoryService)

    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {},
      hasEstimatedValues: false,
      entries: [],
    })
  })
})
