import type postgres from 'postgres'
import { expect, it } from 'vitest'

import { createMealHistoryService } from '@/domain/meal-history/mealHistoryService'
import { describeIfDb, setupTx } from '@/test/db'
import {
  seedFoodMaster,
  seedMealLog,
  seedNutrientDefinition,
} from '@/test/seed'

const seedNutrientDefinitions = async (sql: postgres.Sql): Promise<void> => {
  await seedNutrientDefinition(sql, {
    code: 'energy_kcal',
    displayName: 'energy',
    unit: 'kcal',
    isMajor: true,
    sortOrder: 1,
  })
  await seedNutrientDefinition(sql, {
    code: 'protein_g',
    displayName: 'protein',
    unit: 'g',
    isMajor: true,
    sortOrder: 2,
  })
  await seedNutrientDefinition(sql, {
    code: 'iron_mg',
    displayName: 'iron',
    unit: 'mg',
    isMajor: false,
    sortOrder: 3,
  })
}

describeIfDb('MealHistoryService.query', () => {
  const getTx = setupTx()

  it('aggregates major nutrients by default within the period', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5, iron_mg: 0.1 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
      source: 'user_input',
      nutrients: { energy_kcal: 142, protein_g: 12, iron_mg: 1.5 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })
    await seedMealLog(tx, {
      id: 'log-3',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-02T00:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 * 2 + 142 * 0.5,
        protein_g: 2.5 * 2 + 12 * 0.5,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 * 2 + 142 * 0.5,
            protein_g: 2.5 * 2 + 12 * 0.5,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 200,
          unit: 'g',
          note: null,
        },
        {
          id: 'log-2',
          foodMasterId: 'egg',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 50,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('filters entries and aggregation by foodFilter', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
      source: 'user_input',
      nutrients: { energy_kcal: 142, protein_g: 12 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
        foodFilter: ['egg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { energy_kcal: 71, protein_g: 6 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { energy_kcal: 71, protein_g: 6 },
        },
      ],
      entries: [
        {
          id: 'log-2',
          foodMasterId: 'egg',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 50,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('aggregates only the specified nutrient codes when provided', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'spinach',
      name: 'spinach',
      source: 'user_input',
      nutrients: { energy_kcal: 25, protein_g: 2.2, iron_mg: 2 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'spinach',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
        nutrientCodes: ['iron_mg'],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: { iron_mg: 2 },
      perDay: [
        {
          date: '2026-06-01',
          totals: { iron_mg: 2 },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'spinach',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('returns empty totals when nutrientCodes is an empty array', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
        nutrientCodes: [],
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {},
      perDay: [],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('sets hasEstimatedValues=true when any matching meal references an estimated food', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'mystery_stew',
      name: 'mystery stew',
      isEstimated: true,
      source: 'composition_table_estimate',
      nutrients: { energy_kcal: 200, protein_g: 8 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })
    await seedMealLog(tx, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 250,
    })

    const service = createMealHistoryService(tx)
    const result = (
      await service.query({
        periodFrom: new Date('2026-06-01T00:00:00Z'),
        periodTo: new Date('2026-06-02T00:00:00Z'),
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      totals: {
        energy_kcal: 156 + 200 * 2.5,
        protein_g: 2.5 + 8 * 2.5,
      },
      perDay: [
        {
          date: '2026-06-01',
          totals: {
            energy_kcal: 156 + 200 * 2.5,
            protein_g: 2.5 + 8 * 2.5,
          },
        },
      ],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          eatenAt: new Date('2026-06-01T03:00:00Z'),
          quantity: 100,
          unit: 'g',
          note: null,
        },
        {
          id: 'log-2',
          foodMasterId: 'mystery_stew',
          eatenAt: new Date('2026-06-01T12:00:00Z'),
          quantity: 250,
          unit: 'g',
          note: null,
        },
      ],
      hasEstimatedValues: true,
    })
  })
})
