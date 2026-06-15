import { fileURLToPath } from 'node:url'

import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'

import type { Sql } from '@/db'

export const MIGRATIONS_FOLDER = fileURLToPath(
  new URL('../../drizzle', import.meta.url),
)

export const runMigrations = async (sql: Sql): Promise<void> => {
  const db = drizzle(sql)
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER })
}
