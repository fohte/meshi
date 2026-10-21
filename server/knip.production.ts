import config, {
  project,
  rootWorkspace,
  testHelperExclusions,
} from '#knip-config'

export default {
  ...config,
  workspaces: {
    '.': rootWorkspace,
    server: {
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
        ...testHelperExclusions,
      ],
    },
  },
}
