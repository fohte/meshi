import type postgres from 'postgres'
import { describe } from 'vitest'

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL']

if (TEST_DATABASE_URL !== undefined) {
  const host = new URL(TEST_DATABASE_URL).hostname
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `TEST_DATABASE_URL must point at a local Postgres (got host: ${host}); ` +
        `these tests run DROP SCHEMA CASCADE`,
    )
  }
}

// `describe.skip` when no DB URL is configured so unit-only runs stay green
// without touching Postgres.
export const describeIfDb =
  TEST_DATABASE_URL === undefined ? describe.skip : describe

// Wipe every table declared in the Drizzle schema. Update this list when
// adding new tables so DB-backed tests don't carry over rows between runs.
export const truncate = async (sql: postgres.Sql): Promise<void> => {
  await sql.unsafe(
    'TRUNCATE meal_logs, food_master_aliases, food_master_nutrients, ' +
      'food_composition_nutrients, food_compositions, food_masters, ' +
      'nutrient_definitions, user_profiles RESTART IDENTITY CASCADE',
  )
}
