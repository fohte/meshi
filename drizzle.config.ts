import { defineConfig } from 'drizzle-kit'

// `generate` only diffs the local schema against migration snapshots and
// never opens a connection, so it works fine against a placeholder URL.
const url =
  process.env['DATABASE_URL'] ??
  (process.argv.includes('generate')
    ? 'postgresql://localhost:5432/placeholder'
    : undefined)
if (url === undefined) {
  // eslint-disable-next-line no-restricted-syntax -- drizzle-kit's config file must export a plain object synchronously; there's no Result-consuming caller to return one to
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
