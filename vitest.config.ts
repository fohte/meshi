import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    // The Postgres-backed tests in src/db and src/domain share one TEST_DATABASE_URL
    // and each DROP/CREATE the public schema in beforeAll. Run files sequentially
    // so they don't race on the schema.
    fileParallelism: false,
  },
})
