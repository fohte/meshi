import postgres from 'postgres'

import { runMigrations } from '@/db/migrate'

// Runs once before the vitest test process — wipe the public schema, then
// apply migrations. Tests use per-test transactions and never re-run
// migrations themselves; the schema state is stable for the whole run.
export default async function setup(): Promise<void> {
  const url = process.env['TEST_DATABASE_URL']
  if (url === undefined) return

  const sql = postgres(url, { max: 2, onnotice: () => {} })
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await runMigrations(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
