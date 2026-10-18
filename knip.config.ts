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

export default {
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': {
      project,
    },
  },
  ignoreDependencies: ['@commitlint/cli'],
}
