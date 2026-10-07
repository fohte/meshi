import { errAsync } from 'neverthrow'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import { FoodMatcherQueryError } from '#domain/food-matcher/drizzle-food-matcher'
import {
  MealHistoryQueryError,
  type MealHistoryService,
} from '#domain/meal-history/types'
import { DomainError } from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import type { ConversationOrchestrator } from '#llm/orchestrator/index'
import { createNullLogger } from '#logger'
import type { MeshiToolDeps } from '#mcp-tools'

const rejectingOrchestrator: ConversationOrchestrator = {
  recordFromText: () => Promise.reject(new Error('stub')),
  recordFromImage: () => Promise.reject(new Error('stub')),
  recommendMeal: () => Promise.reject(new Error('stub')),
}

const rejectingMealHistoryService: MealHistoryService = {
  query: () => errAsync(new MealHistoryQueryError('stub')),
}

const rejectingProfileService: UserProfileService = {
  get: () => errAsync(new UserProfileRepositoryError('stub')),
  update: () => errAsync(new UserProfileRepositoryError('stub')),
}

const rejectingFoodMasterService: FoodMasterService = {
  register: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
  getById: () =>
    errAsync(
      new FoodMasterDomainError('persistence_failed', 'foodMasterService stub'),
    ),
  registerFromComposition: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
  findSimilarNames: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
  addAlias: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
  merge: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
}

const rejectingFoodSearchService: FoodSearchService = {
  searchRegistered: () => errAsync(new FoodMatcherQueryError('stub')),
}

const rejectingMealLogService: MealLogService = {
  record: () => errAsync(new DomainError('stub', 'test/unused')),
  recordMany: () => errAsync(new DomainError('stub', 'test/unused')),
  update: () => errAsync(new DomainError('stub', 'test/unused')),
  getById: () => errAsync(new DomainError('stub', 'test/unused')),
  delete: () => errAsync(new DomainError('stub', 'test/unused')),
}
export const createStubMcpDeps = (): MeshiToolDeps => ({
  orchestrator: rejectingOrchestrator,
  mealHistoryService: rejectingMealHistoryService,
  profileService: rejectingProfileService,
  mealLogService: rejectingMealLogService,
  foodSearchService: rejectingFoodSearchService,
  foodMasterService: rejectingFoodMasterService,
  logger: createNullLogger(),
})
