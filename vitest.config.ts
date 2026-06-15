import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    // DB-backed tests run DROP SCHEMA in beforeAll against a shared Postgres;
    // serialize files to avoid the schema resets racing each other.
    fileParallelism: false,
  },
})
