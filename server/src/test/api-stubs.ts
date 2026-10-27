import { errAsync, okAsync } from 'neverthrow'

import type { ApiDeps } from '#api/index'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import { MealLogPersistenceError } from '#domain/meal-log/errors'
import { MealPhotoPersistenceError } from '#domain/meal-photo/errors'
import { MealSetPersistenceError } from '#domain/meal-set/errors'
import { MealSkipPersistenceError } from '#domain/meal-skip/errors'
import { StockDomainError } from '#domain/stock/errors'
import { DEFAULT_USER_PROFILE } from '#domain/user-profile/user-profile'

// createApp's /api deps have their own dedicated route tests; callers that
// only exercise /health still need something satisfying ApiDeps.
export const createStubApiDeps = (): ApiDeps => ({
  mealHistoryService: {
    query: () =>
      okAsync({
        totals: {},
        incompleteNutrients: [],
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
        incompleteNutrients: [],
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
  mealSetService: {
    register: () =>
      errAsync(
        new MealSetPersistenceError('mealSetService.register not stubbed'),
      ),
    list: () => okAsync([]),
    getById: () => okAsync(null),
    update: () =>
      errAsync(
        new MealSetPersistenceError('mealSetService.update not stubbed'),
      ),
    delete: () =>
      errAsync(
        new MealSetPersistenceError('mealSetService.delete not stubbed'),
      ),
    searchByName: () => okAsync([]),
  },
  foodMasterService: {
    fillNutrition: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.fillNutrition not stubbed',
        ),
      ),
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
  stockService: {
    setStockItem: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.setStockItem not stubbed',
        ),
      ),
    countStock: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.countStock not stubbed',
        ),
      ),
    updateStockLot: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.updateStockLot not stubbed',
        ),
      ),
    registerDelivery: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.registerDelivery not stubbed',
        ),
      ),
    updateDeliverySourceRef: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.updateDeliverySourceRef not stubbed',
        ),
      ),
    receiveDelivery: () =>
      errAsync(
        new StockDomainError(
          'persistence_failed',
          'stockService.receiveDelivery not stubbed',
        ),
      ),
    listDeliveries: () => okAsync([]),
    getStockStatus: () =>
      okAsync({
        stockItems: [],
        plannedDeliveries: [],
        capacityWarnings: [],
        eatByWarnings: [],
        priorityLots: [],
      }),
  },
  mealPhotoService: {
    upload: () =>
      errAsync(
        new MealPhotoPersistenceError('mealPhotoService.upload not stubbed'),
      ),
    listForMeal: () => okAsync([]),
    getContent: () =>
      errAsync(
        new MealPhotoPersistenceError(
          'mealPhotoService.getContent not stubbed',
        ),
      ),
    delete: () =>
      errAsync(
        new MealPhotoPersistenceError('mealPhotoService.delete not stubbed'),
      ),
  },
})
