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
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import type { MeshiToolDeps } from '#mcp-tools'
import { createNullLogger } from '#test/logger'

const rejectingMealHistoryService: MealHistoryService = {
  query: () => errAsync(new MealHistoryQueryError('stub')),
}

const rejectingProfileService: UserProfileService = {
  get: () => errAsync(new UserProfileRepositoryError('stub')),
  update: () => errAsync(new UserProfileRepositoryError('stub')),
}

const rejectingFoodMasterService: FoodMasterService = {
  fillNutrition: () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'stub')),
  registerWithSimilarNameCheck: () =>
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
  search: () => errAsync(new FoodMatcherQueryError('stub')),
}

const rejectingMealLogService: MealLogService = {
  record: () => errAsync(new DomainError('stub', 'test/unused')),
  recordMany: () => errAsync(new DomainError('stub', 'test/unused')),
  update: () => errAsync(new DomainError('stub', 'test/unused')),
  getById: () => errAsync(new DomainError('stub', 'test/unused')),
  delete: () => errAsync(new DomainError('stub', 'test/unused')),
  deleteMany: () => errAsync(new DomainError('stub', 'test/unused')),
}

const rejectingMealSkipService: MealSkipService = {
  record: () => errAsync(new MealSkipPersistenceError('stub')),
  cancel: () => errAsync(new MealSkipPersistenceError('stub')),
  findForDate: () => errAsync(new MealSkipPersistenceError('stub')),
}

export const createStubMcpDeps = (): MeshiToolDeps => ({
  mealHistoryService: rejectingMealHistoryService,
  profileService: rejectingProfileService,
  mealLogService: rejectingMealLogService,
  mealSkipService: rejectingMealSkipService,
  foodSearchService: rejectingFoodSearchService,
  foodMasterService: rejectingFoodMasterService,
  logger: createNullLogger(),
})
