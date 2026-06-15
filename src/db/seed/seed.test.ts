import { fileURLToPath } from 'node:url'

import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@/db/migrate'
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

const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

if (TEST_DATABASE_URL !== undefined) {
  const host = new URL(TEST_DATABASE_URL).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a local Postgres (got host: ${host}); ` +
        `these tests run DROP SCHEMA CASCADE`,
    )
  }
}

const describeIfDb = TEST_DATABASE_URL === undefined ? describe.skip : describe

const SAMPLE_DATASET_PATH = fileURLToPath(
  new URL('./__fixtures__/sample-food-composition.json', import.meta.url),
)

const truncate = async (sql: postgres.Sql): Promise<void> => {
  await sql.unsafe(
    'TRUNCATE meal_logs, food_master_aliases, food_master_nutrients, ' +
      'food_composition_nutrients, food_compositions, food_masters, ' +
      'nutrient_definitions, user_profiles RESTART IDENTITY CASCADE',
  )
}

describeIfDb('seed', () => {
  let sql: postgres.Sql

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL ?? '', { max: 4, onnotice: () => {} })
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await runMigrations(sql)
  })

  afterAll(async () => {
    await truncate(sql)
    await sql.end({ timeout: 5 })
  })

  beforeEach(async () => {
    await truncate(sql)
  })

  describe('seedNutrientDefinitions', () => {
    it('inserts the expected major/minor counts and total', async () => {
      await seedNutrientDefinitions(sql)
      const [counts] = await sql<
        { total: number; major: number; minor: number }[]
      >`
        SELECT
          count(*)::int AS total,
          count(*) FILTER (WHERE is_major)::int AS major,
          count(*) FILTER (WHERE NOT is_major)::int AS minor
        FROM nutrient_definitions
      `
      expect(counts).toEqual({
        total: NUTRIENT_DEFINITION_SEEDS.length,
        major: MAJOR_NUTRIENT_DEFINITIONS.length,
        minor: MINOR_NUTRIENT_DEFINITIONS.length,
      })
    })

    it('is idempotent', async () => {
      await seedNutrientDefinitions(sql)
      await seedNutrientDefinitions(sql)
      const rows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM nutrient_definitions
      `
      expect({ count: rows[0]?.count }).toEqual({
        count: NUTRIENT_DEFINITION_SEEDS.length,
      })
    })
  })

  describe('loadFoodComposition', () => {
    it('upserts food_compositions and food_composition_nutrients with expected counts per nutrient', async () => {
      await seedNutrientDefinitions(sql)
      const rows = await loadFoodCompositionDatasetFromFile(SAMPLE_DATASET_PATH)
      const result = await loadFoodComposition(sql, rows)

      const [foodCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM food_compositions
      `
      const nutrientCounts = await sql<
        { nutrient_code: string; count: number }[]
      >`
        SELECT nutrient_code, count(*)::int AS count
        FROM food_composition_nutrients
        GROUP BY nutrient_code
        ORDER BY nutrient_code
      `
      const [nutrientRowCount] = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM food_composition_nutrients
      `

      expect({
        loadResult: result,
        foodCount: foodCount?.count,
        nutrientRowCount: nutrientRowCount?.count,
        nutrientCounts: nutrientCounts.map((r) => ({
          nutrient_code: r.nutrient_code,
          count: r.count,
        })),
      }).toEqual({
        loadResult: { foodCount: 3, nutrientRowCount: 23 },
        foodCount: 3,
        nutrientRowCount: 23,
        nutrientCounts: [
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
        ],
      })
    })

    it('re-loading the same dataset replaces nutrient rows (no stale duplicates)', async () => {
      await seedNutrientDefinitions(sql)
      const rows = await loadFoodCompositionDatasetFromFile(SAMPLE_DATASET_PATH)
      await loadFoodComposition(sql, rows)
      await loadFoodComposition(sql, rows)
      const countRows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM food_composition_nutrients
      `
      expect({ count: countRows[0]?.count }).toEqual({ count: 23 })
    })

    it('splits inserts across batches when the dataset exceeds batchSize', async () => {
      await seedNutrientDefinitions(sql)
      const dataset: ReadonlyArray<{
        code: string
        name: string
        nutrients: Record<string, number>
      }> = Array.from({ length: 5 }, (_, i) => ({
        code: `B${String(i).padStart(4, '0')}`,
        name: `batched-food-${String(i)}`,
        nutrients: { energy_kcal: i + 1, protein_g: (i + 1) * 0.5 },
      }))

      const result = await loadFoodComposition(sql, dataset, { batchSize: 2 })

      const rows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM food_compositions
        WHERE code LIKE 'B%'
      `
      const nutrientRows = await sql<{ count: number }[]>`
        SELECT count(*)::int AS count FROM food_composition_nutrients
        WHERE food_composition_code LIKE 'B%'
      `
      expect({
        result,
        foodCount: rows[0]?.count,
        nutrientCount: nutrientRows[0]?.count,
      }).toEqual({
        result: { foodCount: 5, nutrientRowCount: 10 },
        foodCount: 5,
        nutrientCount: 10,
      })
    })

    it('rejects a non-positive batchSize', async () => {
      await seedNutrientDefinitions(sql)
      const outcome = await loadFoodComposition(
        sql,
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
      await seedNutrientDefinitions(sql)
      const result = await loadFoodComposition(
        sql,
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
      const rows = await sql<{ nutrient_code: string; value: string }[]>`
        SELECT nutrient_code, value::text AS value
        FROM food_composition_nutrients
        WHERE food_composition_code = '99999'
        ORDER BY nutrient_code
      `
      expect({ result, rows }).toEqual({
        result: { foodCount: 1, nutrientRowCount: 2 },
        rows: [
          { nutrient_code: 'custom_nutrient_g', value: '1.5' },
          { nutrient_code: 'protein_g', value: '10' },
        ],
      })
    })

    it('throws FoodCompositionLoadError listing missing nutrient codes', async () => {
      await seedNutrientDefinitions(sql)
      const outcome = await loadFoodComposition(sql, [
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
})

describe('parseFoodCompositionDataset', () => {
  it('throws FoodCompositionLoadError when the dataset contains duplicate codes', () => {
    const outcome = (():
      | { status: 'ok' }
      | { status: 'error'; message: string } => {
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
