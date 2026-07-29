import { existsSync } from 'node:fs'

import type { AgentCard } from '@a2a-js/sdk'
import type { DefaultRequestHandler } from '@a2a-js/sdk/server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'

import { mountA2aRoutes } from '#a2a/hono-bridge'
import { mountApiRoutes } from '#api/index'
import type { Sql } from '#db/index'
import { pingDb } from '#db/index'
import type { DayDetailService } from '#domain/day-detail/types'
import type { MealHistoryService } from '#domain/meal-history/types'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'

// Relative to process.cwd(): the Docker runtime image's WORKDIR (/app) and
// `pnpm dev`/`pnpm start` both run from the repo root, where the web
// subpackage's Vite build output lands at web/dist.
const WEB_DIST_ROOT = 'web/dist'

export interface AppDeps {
  sql: Sql
  agentCard: AgentCard
  requestHandler: DefaultRequestHandler
  mealHistoryService: MealHistoryService
  dayDetailService: DayDetailService
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
    dayDetailService: deps.dayDetailService,
    nutrientDefinitionRepository: deps.nutrientDefinitionRepository,
    userProfileService: deps.userProfileService,
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
