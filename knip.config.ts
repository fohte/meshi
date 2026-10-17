export const project = [
  'src/**/*.ts!',
  'scripts/**/*.ts!',
  '!src/**/*.test.ts!',
  '!src/**/test-helpers.ts!',
  '!src/test/**!',
  '!scripts/**/*.test.ts!',
]

export default {
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': {
      entry: ['src/domain/meal-set/index.ts!'],
      project,
    },
  },
  ignoreDependencies: ['@commitlint/cli'],
}
