import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { createStorybookProject } from '@fohte/storybook-addon/vitest-plugin'
import { defineConfig, mergeConfig } from 'vitest/config'

import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
} from './.storybook/screenshot-viewport'
import viteConfig from './vite.config'

const dirname = path.dirname(fileURLToPath(import.meta.url))

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          ...createStorybookProject({
            name: 'storybook-screenshot-web',
            rootDir: dirname,
            viewport: DESKTOP_VIEWPORT,
            screenshotsSubdir: 'desktop',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['mobile-only'],
          }),
        },
        {
          extends: true,
          ...createStorybookProject({
            name: 'storybook-screenshot-web-mobile',
            rootDir: dirname,
            viewport: MOBILE_VIEWPORT,
            screenshotsSubdir: 'mobile',
            setupFiles: ['./.storybook/vitest.setup.screenshot.ts'],
            excludeTags: ['desktop-only'],
          }),
        },
      ],
    },
  }),
)
