import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: ['./src/test/migration-global-setup.ts'],
    include: ['src/migration-test/*.test.ts'],
    clearMocks: true,
  },
})
