import type { AgentCard } from '@a2a-js/sdk'
import type { DefaultRequestHandler } from '@a2a-js/sdk/server'
import { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'

import { mountA2aRoutes } from '#a2a/hono-bridge'
import { mountApiRoutes } from '#api/index'
import type { Sql } from '#db/index'
import { pingDb } from '#db/index'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

export interface AppDeps {
  sql: Sql
  agentCard: AgentCard
  requestHandler: DefaultRequestHandler
  mealHistoryService: MealHistoryService
  nutrientDefinitionRepository: NutrientDefinitionRepository
  userProfileService: UserProfileService
  bearerToken?: string
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

  mountA2aRoutes(app, {
    agentCard: deps.agentCard,
    requestHandler: deps.requestHandler,
    ...(deps.bearerToken === undefined
      ? {}
      : { bearerToken: deps.bearerToken }),
  })

  mountApiRoutes(app, {
    mealHistoryService: deps.mealHistoryService,
    nutrientDefinitionRepository: deps.nutrientDefinitionRepository,
    userProfileService: deps.userProfileService,
  })

  return app
}
