import type { Hono } from 'hono'

import { mountDayDetailRoutes } from '#api/day-detail-routes'
import { mountFoodMasterRoutes } from '#api/food-master-routes'
import { mountFoodRoutes } from '#api/food-routes'
import { mountMealHistoryRoutes } from '#api/meal-history-routes'
import { mountMealLogRoutes } from '#api/meal-log-routes'
import { mountMealSkipRoutes } from '#api/meal-skip-routes'
import { mountNutrientDefinitionRoutes } from '#api/nutrient-definition-routes'
import { mountProfileRoutes } from '#api/profile-routes'
import type { DayDetailService } from '#domain/day-detail/types'
import type { FoodBrowseService } from '#domain/food-browse/types'
import type { FoodDetailService } from '#domain/food-detail/types'
import type { FoodMasterService } from '#domain/food-master/service'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

export interface ApiDeps {
  mealHistoryService: MealHistoryService
  dayDetailService: DayDetailService
  nutrientDefinitionRepository: NutrientDefinitionRepository
  userProfileService: UserProfileService
  foodBrowseService: FoodBrowseService
  foodDetailService: FoodDetailService
  mealLogService: MealLogService
  foodMasterService: FoodMasterService
  mealSkipService: MealSkipService
}

export const mountApiRoutes = (app: Hono, deps: ApiDeps): void => {
  mountMealHistoryRoutes(app, deps.mealHistoryService)
  mountDayDetailRoutes(app, deps.dayDetailService)
  mountNutrientDefinitionRoutes(app, deps.nutrientDefinitionRepository)
  mountProfileRoutes(app, deps.userProfileService)
  mountFoodRoutes(app, {
    foodBrowseService: deps.foodBrowseService,
    foodDetailService: deps.foodDetailService,
  })
  mountMealLogRoutes(app, deps.mealLogService)
  mountFoodMasterRoutes(app, deps.foodMasterService)
  mountMealSkipRoutes(app, deps.mealSkipService)
}
