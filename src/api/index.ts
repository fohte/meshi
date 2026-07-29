import type { Hono } from 'hono'

import { mountMealHistoryRoutes } from '#api/meal-history-routes'
import { mountNutrientDefinitionRoutes } from '#api/nutrient-definition-routes'
import { mountProfileRoutes } from '#api/profile-routes'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

export interface ApiDeps {
  mealHistoryService: MealHistoryService
  nutrientDefinitionRepository: NutrientDefinitionRepository
  userProfileService: UserProfileService
}

export const mountApiRoutes = (app: Hono, deps: ApiDeps): void => {
  mountMealHistoryRoutes(app, deps.mealHistoryService)
  mountNutrientDefinitionRoutes(app, deps.nutrientDefinitionRepository)
  mountProfileRoutes(app, deps.userProfileService)
}
