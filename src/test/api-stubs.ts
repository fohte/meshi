import { errAsync, okAsync } from 'neverthrow'

import type { ApiDeps } from '#api/index'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import { MealLogPersistenceError } from '#domain/meal-log/errors'
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'

// createApp's /api deps have their own dedicated route tests; callers that
// only exercise /health still need something satisfying ApiDeps.
export const createStubApiDeps = (): ApiDeps => ({
  mealHistoryService: {
    query: () =>
      okAsync({
        totals: {},
        perDay: [],
        entries: [],
        hasEstimatedValues: false,
        hasUnknownValues: false,
      }),
  },
  dayDetailService: {
    query: () =>
      okAsync({
        totals: {},
        hasEstimatedValues: false,
        hasUnknownValues: false,
        entries: [],
        skippedMealTypes: [],
      }),
  },
  nutrientDefinitionRepository: { list: () => okAsync([]) },
  userProfileService: {
    get: () => okAsync(DEFAULT_USER_PROFILE),
    update: () => okAsync(DEFAULT_USER_PROFILE),
  },
  foodBrowseService: {
    search: () => okAsync([]),
    listRecent: () => okAsync([]),
    listFrequent: () => okAsync([]),
  },
  foodDetailService: {
    getById: () => okAsync(null),
  },
  mealLogService: {
    record: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.record not stubbed'),
      ),
    recordMany: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.recordMany not stubbed'),
      ),
    update: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.update not stubbed'),
      ),
    getById: () => okAsync(null),
    delete: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.delete not stubbed'),
      ),
    deleteMany: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.deleteMany not stubbed'),
      ),
  },
  foodMasterService: {
    registerWithSimilarNameCheck: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.registerWithSimilarNameCheck not stubbed',
        ),
      ),
    registerWithoutNutritionWithSimilarNameCheck: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.registerWithoutNutritionWithSimilarNameCheck not stubbed',
        ),
      ),
    getById: () => okAsync(null),
    registerFromComposition: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.registerFromComposition not stubbed',
        ),
      ),
    findSimilarNames: () => okAsync([]),
    addAlias: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.addAlias not stubbed',
        ),
      ),
    merge: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.merge not stubbed',
        ),
      ),
  },
  mealSkipService: {
    record: () =>
      errAsync(
        new MealSkipPersistenceError('mealSkipService.record not stubbed'),
      ),
    cancel: () =>
      errAsync(
        new MealSkipPersistenceError('mealSkipService.cancel not stubbed'),
      ),
    findForDate: () => okAsync([]),
  },
})
