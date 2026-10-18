import config, { project } from '#knip-config'

export default {
  ...config,
  workspaces: {
    '.': {
      entry: [
        'scripts/convert-food-composition.ts!',
        'scripts/seed.ts!',
        'src/db/migrate.ts!',
        'src/index.ts!',
      ],
      project,
    },
    web: {
      project: [
        '**/*.{js,mjs,cjs,jsx,ts,tsx,mts,cts}!',
        '!src/**/test-helpers.ts!',
      ],
    },
  },
}
