import { defineConfig } from 'vitest/config'

<<<<<<< before updating
export default defineConfig({
  test: {
    // Runs DROP/CREATE/migrate once at process start. Per-test isolation
    // is provided by `setupTx()` in src/test/db.ts (BEGIN/ROLLBACK), not
    // by re-running migrations or TRUNCATE.
    globalSetup: ['./src/test/global-setup.ts'],
    // Resets vi.fn()/vi.mock() call history between tests so individual
    // test files don't need their own afterEach(() => mockClear()).
    clearMocks: true,
  },
})
||||||| last update
export default defineConfig({
  resolve: {
    alias: {
      '@': '/src',
    },
  },
})
=======
export default defineConfig({})
>>>>>>> after updating
