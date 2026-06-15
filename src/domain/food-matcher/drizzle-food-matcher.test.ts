import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest'

import { runMigrations } from '@/db/migrate'
import type { FoodMatchCandidate } from '@/domain/food-matcher'
import { createDrizzleFoodMatcher } from '@/domain/food-matcher'
import { describeIfDb, TEST_DATABASE_URL, truncate } from '@/test/db'

const insertMaster = async (
  sql: postgres.Sql,
  id: string,
  name: string,
): Promise<void> => {
  await sql`
    INSERT INTO food_masters (id, name, source)
    VALUES (${id}, ${name}, 'user_input')
  `
}

// Insert a meal_log with eaten_at = now() - interval 'N days' computed in SQL
// so days_since is exact relative to the SELECT (the only drift is the time
// between INSERT and SELECT, which is well under a second).
const insertMealLog = async (
  sql: postgres.Sql,
  id: string,
  foodMasterId: string,
  daysAgo: number,
): Promise<void> => {
  await sql.unsafe(
    `INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
     VALUES ($1, $2, now() - ($3 || ' days')::interval, 1, 'g')`,
    [id, foodMasterId, String(daysAgo)],
  )
}

// Round score to 3 decimal places so the assertion is robust against the tiny
// drift between INSERT-side now() and SELECT-side now().
const normalize = (
  rows: ReadonlyArray<FoodMatchCandidate>,
): ReadonlyArray<FoodMatchCandidate> =>
  rows.map((r) => ({ ...r, score: Number(r.score.toFixed(3)) }))

// pg_trgm similarity is deterministic for fixed inputs. These constants are
// the values returned by `similarity()` in Postgres 17 with default settings;
// rounding to 3dp absorbs the float32 imprecision in the comparison.
const SIM_RICE_RICE_X = 0.714 // similarity('rice', 'rice_a' | 'rice_b')
const SIM_SOUP_SOUP_X = 0.714 // similarity('soup', 'soup_c' | 'soup_d')
const SIM_BREAD_BREAD_E = 0.75
const SIM_CURRY_CURRY_F = 0.75

describeIfDb('createDrizzleFoodMatcher', () => {
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

  it('ranks recently-eaten foods above older ones, both as history_recent', async () => {
    await insertMaster(sql, 'fm_recent_a', 'rice_a')
    await insertMaster(sql, 'fm_recent_b', 'rice_b')
    await insertMealLog(sql, 'ml_ra', 'fm_recent_a', 1)
    await insertMealLog(sql, 'ml_rb', 'fm_recent_b', 5)

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'rice', limit: 5 })

    const expectedA = Number((2 + SIM_RICE_RICE_X * 0.5).toFixed(3))
    const expectedB = Number((2 + SIM_RICE_RICE_X * (1 / (1 + 5))).toFixed(3))
    expect(normalize(result)).toEqual([
      {
        reason: 'history_recent',
        score: expectedA,
        foodMasterId: 'fm_recent_a',
        compositionCode: null,
        name: 'rice_a',
        isEstimated: false,
      },
      {
        reason: 'history_recent',
        score: expectedB,
        foodMasterId: 'fm_recent_b',
        compositionCode: null,
        name: 'rice_b',
        isEstimated: false,
      },
    ])
  })

  it('marks old-but-frequent foods as history_frequent above one-off (fuzzy_name) matches', async () => {
    await insertMaster(sql, 'fm_freq_c', 'soup_c')
    await insertMaster(sql, 'fm_freq_d', 'soup_d')
    for (let i = 0; i < 5; i++) {
      await insertMealLog(sql, `ml_fc_${String(i)}`, 'fm_freq_c', 30)
    }
    await insertMealLog(sql, 'ml_fd', 'fm_freq_d', 30)

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'soup', limit: 5 })

    const expectedC = Number(
      (1 + SIM_SOUP_SOUP_X * (1 - Math.exp(-5 / 3))).toFixed(3),
    )
    expect(normalize(result)).toEqual([
      {
        reason: 'history_frequent',
        score: expectedC,
        foodMasterId: 'fm_freq_c',
        compositionCode: null,
        name: 'soup_c',
        isEstimated: false,
      },
      {
        reason: 'fuzzy_name',
        score: Number(SIM_SOUP_SOUP_X.toFixed(3)),
        foodMasterId: 'fm_freq_d',
        compositionCode: null,
        name: 'soup_d',
        isEstimated: false,
      },
    ])
  })

  it('returns fuzzy_name candidates when the name matches but there is no history', async () => {
    await insertMaster(sql, 'fm_fuzz', 'bread_e')

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'bread', limit: 5 })

    expect(normalize(result)).toEqual([
      {
        reason: 'fuzzy_name',
        score: Number(SIM_BREAD_BREAD_E.toFixed(3)),
        foodMasterId: 'fm_fuzz',
        compositionCode: null,
        name: 'bread_e',
        isEstimated: false,
      },
    ])
  })

  it('falls back to the composition table when no food_master matches', async () => {
    await sql`
      INSERT INTO food_compositions (code, name)
      VALUES ('comp_noodle', 'noodle')
    `

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'noodle', limit: 5 })

    expect(normalize(result)).toEqual([
      {
        reason: 'composition_table',
        score: 1,
        foodMasterId: null,
        compositionCode: 'comp_noodle',
        name: 'noodle',
        isEstimated: true,
      },
    ])
  })

  it('suppresses composition fallback when a food_master already matches', async () => {
    await insertMaster(sql, 'fm_curry', 'curry_f')
    await sql`
      INSERT INTO food_compositions (code, name)
      VALUES ('comp_curry', 'curry')
    `

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'curry', limit: 5 })

    expect(normalize(result)).toEqual([
      {
        reason: 'fuzzy_name',
        score: Number(SIM_CURRY_CURRY_F.toFixed(3)),
        foodMasterId: 'fm_curry',
        compositionCode: null,
        name: 'curry_f',
        isEstimated: false,
      },
    ])
  })

  it('returns an empty array when nothing matches', async () => {
    await insertMaster(sql, 'fm_other', 'pasta_g')

    const matcher = createDrizzleFoodMatcher(sql)
    const result = await matcher.search({ query: 'tofu', limit: 5 })

    expect(result).toEqual([])
  })
})
