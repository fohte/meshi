import { config } from '@fohte/eslint-config'
import storybook from 'eslint-plugin-storybook'

export default config(
  {
    typescript: { typeChecked: true },
    errorHandling: {},
    tailwind: { cssConfigPath: 'web/src/index.css' },
  },
  { ignores: ['dist'] },
  ...storybook.configs['flat/recommended'],
  {
    // vite.config.ts/vitest.config.ts are loaded through Vite's own
    // esbuild-based config loader, which doesn't resolve the package.json
    // "imports" field, unlike the Rollup pipeline that bundles the app
    // itself. .storybook/**/*.ts is loaded the same way, through
    // Storybook's own Node-based config loader.
    files: [
      'web/.storybook/**/*.ts',
      'web/vite.config.ts',
      'web/vitest.config.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
)
