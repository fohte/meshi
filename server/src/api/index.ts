import type { Hono } from 'hono'

import { mountBodyCompositionRoutes } from '#api/body-composition-routes'
import { mountBodyWeightRoutes } from '#api/body-weight-routes'
import { mountDayDetailRoutes } from '#api/day-detail-routes'
import { mountFoodMasterRoutes } from '#api/food-master-routes'
import { mountFoodRoutes } from '#api/food-routes'
import { mountMealHistoryRoutes } from '#api/meal-history-routes'
import { mountMealLogRoutes } from '#api/meal-log-routes'
import { mountMealPhotoRoutes } from '#api/meal-photo-routes'
import { mountMealPlanRoutes } from '#api/meal-plan-routes'
import { mountMealSetRoutes } from '#api/meal-set-routes'
import { mountMealSkipRoutes } from '#api/meal-skip-routes'
import { mountNutrientDefinitionRoutes } from '#api/nutrient-definition-routes'
import { mountProfileRoutes } from '#api/profile-routes'
import { mountStockDeliveryRoutes } from '#api/stock-delivery-routes'
import { mountStockRoutes } from '#api/stock-routes'
import type { BodyCompositionService } from '#domain/body-composition/body-composition-service'
import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import type { DayDetailService } from '#domain/day-detail/types'
import type { FoodBrowseService } from '#domain/food-browse/types'
import type { FoodDetailService } from '#domain/food-detail/types'
import type { FoodMasterService } from '#domain/food-master/service'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealPhotoService } from '#domain/meal-photo/meal-photo-service'
import type { MealPlanService } from '#domain/meal-plan/meal-plan-service'
import type { MealSetService } from '#domain/meal-set/index'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { StockService } from '#domain/stock/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

export interface ApiDeps {
  mealHistoryService: MealHistoryService
  bodyWeightService: BodyWeightService
  bodyCompositionService: BodyCompositionService
  dayDetailService: DayDetailService
  nutrientDefinitionRepository: NutrientDefinitionRepository
  userProfileService: UserProfileService
  foodBrowseService: FoodBrowseService
  foodDetailService: FoodDetailService
  mealLogService: MealLogService
  mealPlanService: MealPlanService
  mealSetService: MealSetService
  mealPhotoService: MealPhotoService
  foodMasterService: FoodMasterService
  mealSkipService: MealSkipService
  stockService: StockService
}

export const mountApiRoutes = (app: Hono, deps: ApiDeps): void => {
  mountMealHistoryRoutes(app, deps.mealHistoryService)
  mountBodyWeightRoutes(app, deps.bodyWeightService)
  mountBodyCompositionRoutes(app, deps.bodyCompositionService)
  mountDayDetailRoutes(app, deps.dayDetailService)
  mountNutrientDefinitionRoutes(app, deps.nutrientDefinitionRepository)
  mountProfileRoutes(app, deps.userProfileService)
  mountFoodRoutes(app, {
    foodBrowseService: deps.foodBrowseService,
    foodDetailService: deps.foodDetailService,
  })
  mountMealLogRoutes(app, deps.mealLogService)
  mountMealPlanRoutes(app, deps.mealPlanService)
  mountMealSetRoutes(app, deps.mealSetService)
  mountMealPhotoRoutes(app, deps.mealPhotoService)
  mountFoodMasterRoutes(app, deps.foodMasterService)
  mountMealSkipRoutes(app, deps.mealSkipService)
  mountStockRoutes(app, deps.stockService)
  mountStockDeliveryRoutes(app, deps.stockService)
}
