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
      project,
    },
  },
  ignoreDependencies: ['@commitlint/cli'],
}
