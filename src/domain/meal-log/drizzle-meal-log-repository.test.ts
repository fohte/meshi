import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { runMigrations } from '@/db/migrate'
import { createDrizzleMealLogRepository } from '@/domain/meal-log/drizzle-meal-log-repository'
import { FoodMasterNotFoundError } from '@/domain/meal-log/errors'
import type { MealLogRow } from '@/domain/meal-log/types'

const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const normalizeRow = (row: MealLogRow): MealLogRow => ({
  ...row,
  createdAt: CREATED_AT_PLACEHOLDER,
})

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

const truncate = async (sql: postgres.Sql): Promise<void> => {
  await sql.unsafe(
    'TRUNCATE meal_logs, food_master_aliases, food_master_nutrients, ' +
      'food_composition_nutrients, food_compositions, food_masters, ' +
      'nutrient_definitions, user_profiles RESTART IDENTITY CASCADE',
  )
}

const seedFoodMaster = async (
  sql: postgres.Sql,
  options: {
    id: string
    name: string
    isEstimated: boolean
    nutrients: ReadonlyArray<{ code: string; value: number }>
  },
): Promise<void> => {
  for (const n of options.nutrients) {
    await sql`
      INSERT INTO nutrient_definitions (code, display_name, unit)
      VALUES (${n.code}, ${n.code}, 'g')
      ON CONFLICT (code) DO NOTHING
    `
  }
  await sql`
    INSERT INTO food_masters (id, name, is_estimated, source)
    VALUES (
      ${options.id},
      ${options.name},
      ${options.isEstimated},
      'user_input'
    )
  `
  for (const n of options.nutrients) {
    await sql`
      INSERT INTO food_master_nutrients (food_master_id, nutrient_code, value)
      VALUES (${options.id}, ${n.code}, ${n.value})
    `
  }
}

describeIfDb('createDrizzleMealLogRepository', () => {
  let sql: postgres.Sql

  beforeAll(async () => {
    sql = postgres(TEST_DATABASE_URL ?? '', { max: 4, onnotice: () => {} })
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await runMigrations(sql)
  })

  beforeEach(async () => {
    await truncate(sql)
  })

  afterAll(async () => {
    await sql.end({ timeout: 5 })
  })

  it('throws FoodMasterNotFoundError when the food_master_id does not exist', async () => {
    const repo = createDrizzleMealLogRepository(sql)
    const error = await repo
      .findFoodMaster('fm_does_not_exist')
      .catch((e: unknown) => e)
    expect({
      isNotFound: error instanceof FoodMasterNotFoundError,
      id:
        error instanceof FoodMasterNotFoundError
          ? error.foodMasterId
          : undefined,
    }).toEqual({
      isNotFound: true,
      id: 'fm_does_not_exist',
    })
  })

  it('round-trips a meal log through insertMealLog + findMealLogById', async () => {
    await seedFoodMaster(sql, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      nutrients: [
        { code: 'protein_g', value: 2.5 },
        { code: 'carb_g', value: 37.1 },
      ],
    })
    const repo = createDrizzleMealLogRepository(sql)

    const inserted = await repo.insertMealLog({
      id: 'ml_round',
      foodMasterId: 'fm_rice',
      eatenAt: new Date('2026-06-15T03:30:00.000Z'),
      quantity: 150,
      unit: 'g',
      note: 'breakfast',
    })
    const fetched = await repo.findMealLogById('ml_round')

    const expectedRow: MealLogRow = {
      id: 'ml_round',
      foodMasterId: 'fm_rice',
      eatenAt: new Date('2026-06-15T03:30:00.000Z'),
      quantity: 150,
      unit: 'g',
      note: 'breakfast',
      createdAt: CREATED_AT_PLACEHOLDER,
    }

    expect({
      inserted: normalizeRow(inserted),
      fetched:
        fetched === null
          ? null
          : { log: normalizeRow(fetched.log), food: fetched.food },
    }).toEqual({
      inserted: expectedRow,
      fetched: {
        log: expectedRow,
        food: {
          id: 'fm_rice',
          name: '白米',
          isEstimated: false,
          nutritionPer100g: {
            protein_g: 2.5,
            carb_g: 37.1,
          },
        },
      },
    })
  })

  it('returns null from findMealLogById when the id is unknown', async () => {
    const repo = createDrizzleMealLogRepository(sql)
    expect(await repo.findMealLogById('ml_missing')).toBeNull()
  })
})
