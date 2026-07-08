import { defineConfig } from 'drizzle-kit'

const url = process.env['DATABASE_URL']
if (url === undefined) {
  throw new Error(
    'DATABASE_URL is required (run `docker compose port postgres 5432` for the local Postgres URL)',
  )
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
