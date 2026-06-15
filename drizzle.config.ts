import { defineConfig } from 'drizzle-kit'

const url =
  process.env['DATABASE_URL'] ?? 'postgres://meshi:meshi@127.0.0.1:5432/meshi'

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
