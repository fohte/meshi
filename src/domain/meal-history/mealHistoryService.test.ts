import type postgres from 'postgres'
import { expect, it } from 'vitest'

import { createMealHistoryService } from '@/domain/meal-history/mealHistoryService'
import { describeIfDb, setupTx } from '@/test/db'

const seedNutrientDefinitions = async (sql: postgres.Sql): Promise<void> => {
  await sql`
    INSERT INTO nutrient_definitions (code, display_name, unit, is_major, sort_order)
    VALUES
      ('energy_kcal', 'energy', 'kcal', true, 1),
      ('protein_g', 'protein', 'g', true, 2),
      ('iron_mg', 'iron', 'mg', false, 3)
  `
}

interface FoodMasterSeed {
  readonly id: string
  readonly name: string
  readonly isEstimated?: boolean
  readonly nutrients: Readonly<Record<string, number>>
}

const seedFoodMaster = async (
  sql: postgres.Sql,
  food: FoodMasterSeed,
): Promise<void> => {
  const isEstimated = food.isEstimated ?? false
  const source = isEstimated ? 'composition_table_estimate' : 'user_input'
  await sql`
    INSERT INTO food_masters (id, name, is_estimated, source)
    VALUES (${food.id}, ${food.name}, ${isEstimated}, ${source})
  `
  for (const [code, value] of Object.entries(food.nutrients)) {
    await sql`
      INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
      VALUES (${food.id}, ${code}, ${value})
    `
  }
}

interface MealLogSeed {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly quantity: number
  readonly unit?: string
}

const seedMealLog = async (
  sql: postgres.Sql,
  entry: MealLogSeed,
): Promise<void> => {
  await sql`
    INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
    VALUES (
      ${entry.id},
      ${entry.foodMasterId},
      ${entry.eatenAt},
      ${entry.quantity},
      ${entry.unit ?? 'g'}
    )
  `
}

describeIfDb('MealHistoryService.query', () => {
  const getTx = setupTx()

  it('aggregates major nutrients by default within the period', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5, iron_mg: 0.1 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
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
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'egg',
      name: 'egg',
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
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'spinach',
      name: 'spinach',
      nutrients: { energy_kcal: 25, protein_g: 2.2, iron_mg: 2 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'spinach',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
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
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedMealLog(tx, {
      id: 'log-1',
      foodMasterId: 'rice',
      eatenAt: new Date('2026-06-01T03:00:00Z'),
      quantity: 100,
    })

    const service = createMealHistoryService(tx)
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
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedFoodMaster(tx, {
      id: 'rice',
      name: 'rice',
      nutrients: { energy_kcal: 156, protein_g: 2.5 },
    })
    await seedFoodMaster(tx, {
      id: 'mystery_stew',
      name: 'mystery stew',
      isEstimated: true,
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
