import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BLOCK_EXTERNAL_REQUESTS_ARGS } from '@fohte/storybook-addon/vitest-plugin'
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
            exclude: [
              '**/node_modules/**',
              '**/dist/**',
              '**/cypress/**',
              '**/.{idea,git,cache,output,temp}/**',
              '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build}.config.*',
              'src/components/MealPhotoGallery/MealPhotoGallery.test.tsx',
            ],
          },
        },
        {
          extends: true,
          test: {
            name: 'component-browser',
            include: [
              'src/components/MealPhotoGallery/MealPhotoGallery.test.tsx',
            ],
            browser: {
              enabled: true,
              provider: playwright(),
              headless: true,
              instances: [{ browser: 'chromium' }],
            },
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
              provider: playwright({
                launchOptions: { args: [...BLOCK_EXTERNAL_REQUESTS_ARGS] },
              }),
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
