import postgres from 'postgres'

import { runMigrations } from '@/db/migrations'
import { setupMeshiCheckpointSchema } from '@/llm/agent/checkpointer'

export default async function setup(): Promise<void> {
  // No-op when TEST_DATABASE_URL is unset so unit-only runs don't need a DB.
  const url = process.env['TEST_DATABASE_URL']
  if (url === undefined) return

  const sql = postgres(url, { max: 2, onnotice: () => {} })
  // eslint-disable-next-line no-restricted-syntax -- vitest's globalSetup contract itself expects this function to throw to fail the whole run; try/finally here only guarantees sql.end() runs either way
  try {
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE')
    await sql.unsafe('DROP SCHEMA IF EXISTS drizzle CASCADE')
    await sql.unsafe('CREATE SCHEMA public')
    await runMigrations(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
  await setupMeshiCheckpointSchema(url)
}
