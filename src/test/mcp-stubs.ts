import { errAsync } from 'neverthrow'

import { UserProfileRepositoryError } from '@/domain/user-profile/errors'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import type { ConversationOrchestrator } from '@/llm/orchestrator'
import { createNullLogger } from '@/logger'
import type { MeshiToolDeps } from '@/mcp-tools'

const rejectingOrchestrator: ConversationOrchestrator = {
  recordFromText: () => Promise.reject(new Error('stub')),
  recordFromImage: () => Promise.reject(new Error('stub')),
  queryMeals: () => Promise.reject(new Error('stub')),
  recommendMeal: () => Promise.reject(new Error('stub')),
}

const rejectingProfileService: UserProfileService = {
  get: () => errAsync(new UserProfileRepositoryError('stub')),
  update: () => errAsync(new UserProfileRepositoryError('stub')),
}

export const createStubMcpDeps = (): MeshiToolDeps => ({
  orchestrator: rejectingOrchestrator,
  profileService: rejectingProfileService,
  logger: createNullLogger(),
})
