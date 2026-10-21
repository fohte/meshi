import { existsSync } from 'node:fs'

import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'

import { mountApiRoutes } from '#api/index'
import type { Sql } from '#db/index'
import { pingDb } from '#db/index'
import type { DayDetailService } from '#domain/day-detail/types'
import type { FoodBrowseService } from '#domain/food-browse/types'
import type { FoodDetailService } from '#domain/food-detail/types'
import type { FoodMasterService } from '#domain/food-master/index'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealPhotoService } from '#domain/meal-photo/meal-photo-service'
import type { MealSetService } from '#domain/meal-set/index'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { StockService } from '#domain/stock/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import { resolveWebDistRoot } from '#web-dist-root'

const WEB_DIST_ROOT = resolveWebDistRoot(process.cwd())

export interface AppDeps {
  sql: Sql
  mealHistoryService: MealHistoryService
  dayDetailService: DayDetailService
  nutrientDefinitionRepository: NutrientDefinitionRepository
  userProfileService: UserProfileService
  foodBrowseService: FoodBrowseService
  foodDetailService: FoodDetailService
  mealLogService: MealLogService
  mealSetService: MealSetService
  mealPhotoService: MealPhotoService
  foodMasterService: FoodMasterService
  mealSkipService: MealSkipService
  stockService: StockService
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

export const createApp = (deps: AppDeps): Hono => {
  const app = new Hono()

  app.get('/health', async (c) =>
    ResultAsync.fromPromise(pingDb(deps.sql), errorMessage).match(
      () => c.json({ status: 'ok' }),
      (message) => c.json({ status: 'error', error: message }, 503),
    ),
  )

  mountApiRoutes(app, {
    mealHistoryService: deps.mealHistoryService,
    dayDetailService: deps.dayDetailService,
    nutrientDefinitionRepository: deps.nutrientDefinitionRepository,
    userProfileService: deps.userProfileService,
    foodBrowseService: deps.foodBrowseService,
    foodDetailService: deps.foodDetailService,
    mealLogService: deps.mealLogService,
    mealSetService: deps.mealSetService,
    mealPhotoService: deps.mealPhotoService,
    foodMasterService: deps.foodMasterService,
    mealSkipService: deps.mealSkipService,
    stockService: deps.stockService,
  })

  // SPA static assets, then an index.html fallback for client-side routes
  // (e.g. /history). Registered last so they never shadow the routes above.
  // Guarded on existence: @hono/node-server's serveStatic logs a
  // console.error at construction time when root is missing (e.g. `pnpm dev`
  // without having run `pnpm --filter web run build` yet).
  if (existsSync(WEB_DIST_ROOT)) {
    app.use('*', serveStatic({ root: WEB_DIST_ROOT }))
    app.get('*', serveStatic({ root: WEB_DIST_ROOT, path: 'index.html' }))
  }

  return app
}
