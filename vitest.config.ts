import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  test: {
    // Several suites tear down and re-migrate the same TEST_DATABASE_URL
    // Postgres; running them concurrently would race on schema setup.
    fileParallelism: false,
  },
})
