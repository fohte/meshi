import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'

// The "#*" subpath import mapping (package.json "imports") only covers
// src/, not sibling config files at the package root.
import viteConfig from './vite.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// vitest.config.ts fully replaces vite.config.ts rather than extending it
// (Vitest only reads one or the other), so the tailwindcss/react plugins
// have to be pulled in explicitly via mergeConfig.
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'unit',
          },
        },
        {
          extends: true,
          plugins: [
            storybookTest({ configDir: path.join(dirname, '.storybook') }),
          ],
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
            setupFiles: ['./.storybook/vitest.setup.ts'],
          },
        },
      ],
    },
  }),
)
