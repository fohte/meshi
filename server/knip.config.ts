export const testHelperExclusions = [
  '!src/**/test-helpers.ts!',
  '!src/test/**!',
]

export const project = [
  'src/**/*.ts!',
  'scripts/**/*.ts!',
  '!src/**/*.test.ts!',
  ...testHelperExclusions,
  '!scripts/**/*.test.ts!',
]

export const rootWorkspace = {
  ignoreDependencies: ['@commitlint/cli'],
  ignore: ['commitlint-plugin-no-external-refs.cjs'],
}

export default {
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': rootWorkspace,
    server: {
      project,
    },
    web: {},
  },
}
