import { okAsync } from 'neverthrow'

import type { ApiDeps } from '#api/index'
import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'

// createApp's /api deps have their own dedicated route tests; callers that
// only exercise /health or /a2a still need something satisfying ApiDeps.
export const createStubApiDeps = (): ApiDeps => ({
  mealHistoryService: {
    query: () =>
      okAsync({
        totals: {},
        perDay: [],
        entries: [],
        hasEstimatedValues: false,
      }),
  },
  dayDetailService: {
    query: () =>
      okAsync({ totals: {}, hasEstimatedValues: false, entries: [] }),
  },
  nutrientDefinitionRepository: { list: () => okAsync([]) },
  userProfileService: {
    get: () => okAsync(DEFAULT_USER_PROFILE),
    update: () => okAsync(DEFAULT_USER_PROFILE),
  },
})
