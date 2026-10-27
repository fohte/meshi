import { errAsync, okAsync } from 'neverthrow'

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
import { MealSetPersistenceError } from '#domain/meal-set/errors'
import type { MealSetService } from '#domain/meal-set/meal-set-service'
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import { StockDomainError } from '#domain/stock/errors'
import type { StockService } from '#domain/stock/types'
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
  registerWithoutNutritionWithSimilarNameCheck: () =>
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

const rejectingMealSetService: MealSetService = {
  register: () => errAsync(new MealSetPersistenceError('stub')),
  list: () => errAsync(new MealSetPersistenceError('stub')),
  getById: () => errAsync(new MealSetPersistenceError('stub')),
  update: () => errAsync(new MealSetPersistenceError('stub')),
  delete: () => errAsync(new MealSetPersistenceError('stub')),
  searchByName: () => okAsync([]),
}

const rejectingMealSkipService: MealSkipService = {
  record: () => errAsync(new MealSkipPersistenceError('stub')),
  cancel: () => errAsync(new MealSkipPersistenceError('stub')),
  findForDate: () => errAsync(new MealSkipPersistenceError('stub')),
}

const rejectingStockService: StockService = {
  setStockItem: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  countStock: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  updateStockLot: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  registerDelivery: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  receiveDelivery: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  listDeliveries: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
  getStockStatus: () =>
    errAsync(new StockDomainError('persistence_failed', 'stub')),
}

export const createStubMcpDeps = (): MeshiToolDeps => ({
  mealHistoryService: rejectingMealHistoryService,
  profileService: rejectingProfileService,
  mealLogService: rejectingMealLogService,
  mealSetService: rejectingMealSetService,
  mealSkipService: rejectingMealSkipService,
  stockService: rejectingStockService,
  foodSearchService: rejectingFoodSearchService,
  foodMasterService: rejectingFoodMasterService,
  logger: createNullLogger(),
})
