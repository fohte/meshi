import { drizzle } from 'drizzle-orm/postgres-js'
import { expect, it } from 'vitest'

import {
  foodMasterNutrients,
  foodMasters,
  mealLogs,
  nutrientDefinitions,
} from '@/db/schema'
import { createMealHistoryService } from '@/domain/meal-history/mealHistoryService'
import { describeIfDb, setupTx } from '@/test/db'

describeIfDb('MealHistoryService.query', () => {
  const getTx = setupTx()

  const seedNutrientDefinitions = async (
    db: ReturnType<typeof drizzle>,
  ): Promise<void> => {
    await db.insert(nutrientDefinitions).values([
      {
        code: 'energy_kcal',
        displayName: 'energy',
        unit: 'kcal',
        isMajor: true,
        sortOrder: 1,
      },
      {
        code: 'protein_g',
        displayName: 'protein',
        unit: 'g',
        isMajor: true,
        sortOrder: 2,
      },
      {
        code: 'iron_mg',
        displayName: 'iron',
        unit: 'mg',
        isMajor: false,
        sortOrder: 3,
      },
    ])
  }

  interface FoodMasterSeed {
    readonly id: string
    readonly name: string
    readonly isEstimated?: boolean
    readonly nutrients: Readonly<Record<string, number>>
  }

  const seedFoodMaster = async (
    db: ReturnType<typeof drizzle>,
    food: FoodMasterSeed,
  ): Promise<void> => {
    const isEstimated = food.isEstimated ?? false
    await db.insert(foodMasters).values({
      id: food.id,
      name: food.name,
      isEstimated,
      source: isEstimated ? 'composition_table_estimate' : 'user_input',
      sourceUrl: null,
    })
    await db.insert(foodMasterNutrients).values(
      Object.entries(food.nutrients).map(([code, value]) => ({
        foodMasterId: food.id,
        nutrientCode: code,
        value: String(value),
      })),
    )
  }

  interface MealLogSeed {
    readonly id: string
    readonly foodMasterId: string
    readonly eatenAt: Date
    readonly quantity: number
    readonly unit?: string
  }

  const seedMealLog = async (
    db: ReturnType<typeof drizzle>,
    entry: MealLogSeed,
  ): Promise<void> => {
    await db.insert(mealLogs).values({
      id: entry.id,
      foodMasterId: entry.foodMasterId,
      eatenAt: entry.eatenAt,
      quantity: String(entry.quantity),
      unit: entry.unit ?? 'g',
      note: null,
    })
  }

  it('aggregates major nutrients by default within the period', async () => {
    const db = drizzle(getTx())
    await seedNutrientDefinitions(db)
    await seedFoodMaster(db, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5, iron_mg: 0.1 },
    })
    await seedFoodMaster(db, {
      id: 'egg',
      name: 'egg',
      nutrients: { energy_kcal: 142, protein_g: 12, iron_mg: 1.5 },
    })
    await seedMealLog(db, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(db, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })
    await seedMealLog(db, {
      id: 'log-3',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-02T00:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(db)
    const result = await service.query({
      periodFrom: new Date('2026-06-01T00:00:00Z'),
      periodTo: new Date('2026-06-02T00:00:00Z'),
    })

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
    const db = drizzle(getTx())
    await seedNutrientDefinitions(db)
    await seedFoodMaster(db, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(db, {
      id: 'egg',
      name: 'egg',
      nutrients: { energy_kcal: 142, protein_g: 12 },
    })
    await seedMealLog(db, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 200,
    })
    await seedMealLog(db, {
      id: 'log-2',
      foodMasterId: 'egg',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 50,
    })

    const service = createMealHistoryService(db)
    const result = await service.query({
      periodFrom: new Date('2026-06-01T00:00:00Z'),
      periodTo: new Date('2026-06-02T00:00:00Z'),
      foodFilter: ['egg'],
    })

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
    const db = drizzle(getTx())
    await seedNutrientDefinitions(db)
    await seedFoodMaster(db, {
      id: 'spinach',
      name: 'spinach',
      nutrients: { energy_kcal: 25, protein_g: 2.2, iron_mg: 2 },
    })
    await seedMealLog(db, {
      id: 'log-1',
      foodMasterId: 'spinach',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(db)
    const result = await service.query({
      periodFrom: new Date('2026-06-01T00:00:00Z'),
      periodTo: new Date('2026-06-02T00:00:00Z'),
      nutrientCodes: ['iron_mg'],
    })

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
    const db = drizzle(getTx())
    await seedNutrientDefinitions(db)
    await seedFoodMaster(db, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedMealLog(db, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(db)
    const result = await service.query({
      periodFrom: new Date('2026-06-01T00:00:00Z'),
      periodTo: new Date('2026-06-02T00:00:00Z'),
      nutrientCodes: [],
    })

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
    const db = drizzle(getTx())
    await seedNutrientDefinitions(db)
    await seedFoodMaster(db, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(db, {
      id: 'mystery_stew',
      name: 'mystery stew',
      isEstimated: true,
      nutrients: { energy_kcal: 200, protein_g: 8 },
    })
    await seedMealLog(db, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })
    await seedMealLog(db, {
      id: 'log-2',
      foodMasterId: 'mystery_stew',
      eatenAt: new Date('2026-06-01T12:00:00Z'),
      quantity: 250,
    })

    const service = createMealHistoryService(db)
    const result = await service.query({
      periodFrom: new Date('2026-06-01T00:00:00Z'),
      periodTo: new Date('2026-06-02T00:00:00Z'),
    })

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
