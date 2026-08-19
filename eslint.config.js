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
    // vite.config.ts/vitest.config.ts and .storybook/main.ts can't rely on
    // the "#" alias to reference sibling files: that alias is defined
    // inside vite.config.ts itself (see its resolve.alias), so it isn't
    // available yet while Vite or Storybook's own Node-based loader is
    // still loading the config that would define it. .storybook/preview.ts
    // and story files don't hit this — Storybook bundles them through the
    // project's own vite.config.ts, where the alias is already in effect —
    // but they're covered by the same glob to keep this exemption scoped
    // to the whole .storybook/ directory rather than file-by-file.
    files: [
      'web/.storybook/**/*.ts',
      'web/vite.config.ts',
      'web/vitest.config.ts',
    ],
    rules: { 'no-restricted-imports': 'off' },
  },
)
