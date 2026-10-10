import { describe, expect, it } from 'vitest'

import { captureSqlCalls } from '#test/db'
import { seedFoodMaster } from '#test/seed'

const summarizeCalls = (
  calls: ReadonlyArray<{ query: string; params: unknown[] }>,
): ReadonlyArray<{ table: string | null; params: unknown[] }> =>
  calls.map(({ query, params }) => ({
    table: query.match(/INSERT INTO ([a-z_]+)/)?.[1] ?? null,
    params,
  }))

describe('seedFoodMaster', () => {
  it('seeds nutrient definitions in stable order before food masters', async () => {
    const { sql, calls } = captureSqlCalls()

    await seedFoodMaster(sql, {
      id: 'fm_reversed',
      name: 'reversed nutrients',
      source: 'user_input',
      nutrients: { protein_g: 4, energy_kcal: 20 },
    })
    await seedFoodMaster(sql, {
      id: 'fm_sorted',
      name: 'sorted nutrients',
      source: 'user_input',
      nutrients: { energy_kcal: 20, protein_g: 4 },
    })

    expect(summarizeCalls(calls)).toEqual([
      {
        table: 'nutrient_definitions',
        params: ['energy_kcal', 'energy_kcal', 'g', false, 0],
      },
      {
        table: 'nutrient_definitions',
        params: ['protein_g', 'protein_g', 'g', false, 0],
      },
      {
        table: 'food_masters',
        params: ['fm_reversed', 'reversed nutrients'],
      },
      {
        table: 'food_master_nutrition',
        params: ['fm_reversed', false, 'user_input', null, null],
      },
      {
        table: 'food_master_nutrients',
        params: ['fm_reversed', 'energy_kcal', 20],
      },
      {
        table: 'food_master_nutrients',
        params: ['fm_reversed', 'protein_g', 4],
      },
      {
        table: 'nutrient_definitions',
        params: ['energy_kcal', 'energy_kcal', 'g', false, 0],
      },
      {
        table: 'nutrient_definitions',
        params: ['protein_g', 'protein_g', 'g', false, 0],
      },
      {
        table: 'food_masters',
        params: ['fm_sorted', 'sorted nutrients'],
      },
      {
        table: 'food_master_nutrition',
        params: ['fm_sorted', false, 'user_input', null, null],
      },
      {
        table: 'food_master_nutrients',
        params: ['fm_sorted', 'energy_kcal', 20],
      },
      {
        table: 'food_master_nutrients',
        params: ['fm_sorted', 'protein_g', 4],
      },
    ])
  })
})
