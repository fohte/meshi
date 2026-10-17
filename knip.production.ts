import config, { mealSetEntry, project } from '#knip-config'

export default {
  ...config,
  workspaces: {
    '.': {
      entry: [
        'scripts/convert-food-composition.ts!',
        'scripts/seed.ts!',
        'src/db/migrate.ts!',
        mealSetEntry,
        'src/index.ts!',
      ],
      project,
    },
  },
}
