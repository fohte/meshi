import { expect, it } from 'vitest'

import { createDayDetailService } from '#domain/day-detail/day-detail-service'
import { createMealHistoryService } from '#domain/meal-history/mealHistoryService'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMaster, seedMealLog, seedNutrientDefinition } from '#test/seed'

describeIfDb('DayDetailService.query', () => {
  const getTx = setupDrizzleTx()

  it('enriches entries with food name, per-item kcal, and the estimated flag', async () => {
    const tx = getTx()
    await seedNutrientDefinition(tx, {
      code: 'energy_kcal',
      displayName: 'energy',
      unit: 'kcal',
      isMajor: true,
      sortOrder: 1,
    })
    await seedNutrientDefinition(tx, {
      code: 'protein_g',
      displayName: 'protein',
      unit: 'g',
      isMajor: true,
      sortOrder: 2,
    })
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'ごはん',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'mystery_stew',
      name: 'なぞのシチュー',
      isEstimated: true,
      source: 'composition_table_estimate',
      nutrients: { energy_kcal: 200, protein_g: 8 },
    })
    // 00:00Z is 09:00 JST (breakfast); 09:00Z is 18:00 JST (dinner).
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

    const mealHistoryService = createMealHistoryService(tx)
    const service = createDayDetailService(tx, mealHistoryService)

    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 * 2 + 200 * 0.5,
        protein_g: 2.5 * 2 + 8 * 0.5,
      },
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

  it('returns empty totals and entries when nothing was eaten in the period', async () => {
    const tx = getTx()
    const mealHistoryService = createMealHistoryService(tx)
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
