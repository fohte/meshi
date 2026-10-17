export const project = [
  'src/**/*.ts!',
  'scripts/**/*.ts!',
  '!src/**/*.test.ts!',
  '!src/**/test-helpers.ts!',
  '!src/test/**!',
  '!scripts/**/*.test.ts!',
]

export const mealSetEntry = 'src/domain/meal-set/index.ts!'

export default {
  treatConfigHintsAsErrors: true,
  workspaces: {
    '.': {
      entry: [mealSetEntry],
      project,
    },
  },
  ignoreDependencies: ['@commitlint/cli'],
}
