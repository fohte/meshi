import type { Logger } from '#logger'

export const createNullLogger = (): Logger => ({
  log() {},
})
