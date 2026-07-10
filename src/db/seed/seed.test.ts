import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  FoodCompositionLoadError,
  loadFoodComposition,
  loadFoodCompositionDatasetFromFile,
  MAJOR_NUTRIENT_DEFINITIONS,
  MINOR_NUTRIENT_DEFINITIONS,
  NUTRIENT_DEFINITION_SEEDS,
  parseFoodCompositionDataset,
  seedNutrientDefinitions,
} from '@/db/seed'
import { describeIfDb, setupTx } from '@/test/db'

const SAMPLE_DATASET_PATH = fileURLToPath(
  new URL('./__fixtures__/sample-food-composition.json', import.meta.url),
)

describeIfDb('seedNutrientDefinitions', () => {
  const getTx = setupTx()

  it('inserts the expected major/minor counts and total', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const rows = await tx<{ total: number; major: number; minor: number }[]>`
      SELECT
        count(*)::int AS total,
        count(*) FILTER (WHERE is_major)::int AS major,
        count(*) FILTER (WHERE NOT is_major)::int AS minor
      FROM nutrient_definitions
    `
    expect(rows[0]).toEqual({
      total: NUTRIENT_DEFINITION_SEEDS.length,
      major: MAJOR_NUTRIENT_DEFINITIONS.length,
      minor: MINOR_NUTRIENT_DEFINITIONS.length,
    })
  })

  it('is idempotent', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    await seedNutrientDefinitions(tx)
    const rows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM nutrient_definitions
    `
    expect(rows[0]?.count).toBe(NUTRIENT_DEFINITION_SEEDS.length)
  })
})

describeIfDb('loadFoodComposition', () => {
  const getTx = setupTx()

  it('upserts food_compositions and food_composition_nutrients with expected counts per nutrient', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const rows = await loadFoodCompositionDatasetFromFile(SAMPLE_DATASET_PATH)
    const result = await loadFoodComposition(tx, rows)

    const foodCount = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM food_compositions
    `
    const nutrientCounts = await tx<{ nutrient_code: string; count: number }[]>`
      SELECT nutrient_code, count(*)::int AS count
      FROM food_composition_nutrients
      GROUP BY nutrient_code
      ORDER BY nutrient_code
    `
    const nutrientRowCount = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM food_composition_nutrients
    `

    expect(result).toEqual({ foodCount: 3, nutrientRowCount: 23 })
    expect(foodCount[0]?.count).toBe(3)
    expect(nutrientRowCount[0]?.count).toBe(23)
    expect(
      nutrientCounts.map((r) => ({
        nutrient_code: r.nutrient_code,
        count: r.count,
      })),
    ).toEqual([
      { nutrient_code: 'carb_g', count: 3 },
      { nutrient_code: 'dietary_fiber_g', count: 1 },
      { nutrient_code: 'energy_kcal', count: 3 },
      { nutrient_code: 'fat_g', count: 3 },
      { nutrient_code: 'iron_mg', count: 3 },
      { nutrient_code: 'potassium_mg', count: 1 },
      { nutrient_code: 'protein_g', count: 3 },
      { nutrient_code: 'salt_g', count: 3 },
      { nutrient_code: 'vitamin_a_µg', count: 1 },
      { nutrient_code: 'vitamin_b12_µg', count: 1 },
      { nutrient_code: 'vitamin_d_µg', count: 1 },
    ])
  })

  it('re-loading the same dataset replaces nutrient rows (no stale duplicates)', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const rows = await loadFoodCompositionDatasetFromFile(SAMPLE_DATASET_PATH)
    await loadFoodComposition(tx, rows)
    await loadFoodComposition(tx, rows)
    const countRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM food_composition_nutrients
    `
    expect(countRows[0]?.count).toBe(23)
  })

  it('splits inserts across batches when the dataset exceeds batchSize', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const dataset: ReadonlyArray<{
      code: string
      name: string
      nutrients: Record<string, number>
    }> = Array.from({ length: 5 }, (_, i) => ({
      code: `B${String(i).padStart(4, '0')}`,
      name: `batched-food-${String(i)}`,
      nutrients: { energy_kcal: i + 1, protein_g: (i + 1) * 0.5 },
    }))

    const result = await loadFoodComposition(tx, dataset, { batchSize: 2 })

    const foodRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM food_compositions WHERE code LIKE 'B%'
    `
    const nutrientRows = await tx<{ count: number }[]>`
      SELECT count(*)::int AS count FROM food_composition_nutrients
      WHERE food_composition_code LIKE 'B%'
    `
    expect(result).toEqual({ foodCount: 5, nutrientRowCount: 10 })
    expect(foodRows[0]?.count).toBe(5)
    expect(nutrientRows[0]?.count).toBe(10)
  })

  it('rejects a non-positive batchSize', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const outcome = await loadFoodComposition(
      tx,
      [{ code: 'X1', name: 'x', nutrients: { protein_g: 1 } }],
      { batchSize: 0 },
    )
      .then(() => ({ status: 'ok' as const }))
      .catch((err: unknown) => ({
        status: 'error' as const,
        isLoadError: err instanceof FoodCompositionLoadError,
      }))
    expect(outcome).toEqual({ status: 'error', isLoadError: true })
  })

  it('registers extra nutrient_definitions before inserting unknown nutrient codes', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const result = await loadFoodComposition(
      tx,
      [
        {
          code: '99999',
          name: 'テスト食品',
          nutrients: { protein_g: 10, custom_nutrient_g: 1.5 },
        },
      ],
      {
        extraNutrientDefinitions: [
          {
            code: 'custom_nutrient_g',
            displayName: 'カスタム栄養素',
            unit: 'g',
            isMajor: false,
            sortOrder: 99,
          },
        ],
      },
    )
    const rows = await tx<{ nutrient_code: string; value: string }[]>`
      SELECT nutrient_code, value::text AS value
      FROM food_composition_nutrients
      WHERE food_composition_code = '99999'
      ORDER BY nutrient_code
    `
    expect(result).toEqual({ foodCount: 1, nutrientRowCount: 2 })
    expect(rows).toEqual([
      { nutrient_code: 'custom_nutrient_g', value: '1.5' },
      { nutrient_code: 'protein_g', value: '10' },
    ])
  })

  it('throws FoodCompositionLoadError listing missing nutrient codes', async () => {
    const tx = getTx()
    await seedNutrientDefinitions(tx)
    const outcome = await loadFoodComposition(tx, [
      {
        code: '88888',
        name: 'unknown nutrient food',
        nutrients: { unknown_nutrient_g: 1 },
      },
    ])
      .then(() => ({ status: 'ok' as const }))
      .catch((err: unknown) => ({
        status: 'error' as const,
        isLoadError: err instanceof FoodCompositionLoadError,
        missingNutrientCodes:
          err instanceof FoodCompositionLoadError
            ? err.missingNutrientCodes
            : undefined,
      }))
    expect(outcome).toEqual({
      status: 'error',
      isLoadError: true,
      missingNutrientCodes: ['unknown_nutrient_g'],
    })
  })
})

describe('parseFoodCompositionDataset', () => {
  it('throws FoodCompositionLoadError when the dataset contains duplicate codes', () => {
    const outcome = (():
      { status: 'ok' } | { status: 'error'; message: string } => {
      try {
        parseFoodCompositionDataset([
          { code: '01001', name: 'a', nutrients: { protein_g: 1 } },
          { code: '01001', name: 'b', nutrients: { protein_g: 2 } },
        ])
        return { status: 'ok' as const }
      } catch (err) {
        return {
          status: 'error' as const,
          message:
            err instanceof FoodCompositionLoadError ? err.message : String(err),
        }
      }
    })()
    expect(outcome).toEqual({
      status: 'error',
      message: 'duplicate food composition codes in dataset: 01001',
    })
  })
})
