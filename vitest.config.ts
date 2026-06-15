import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    // DB-backed test files share one Postgres and reset its schema in beforeAll;
    // run them sequentially so their setups don't race.
    fileParallelism: false,
  },
})
