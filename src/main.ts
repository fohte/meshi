import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { getRequestListener } from '@hono/node-server'
import * as Sentry from '@sentry/node'

import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import { createApp } from '#app'
import { observability } from '#bootstrap'
import { createSql, pingDb } from '#db/index'
import { runMigrations } from '#db/migrations'
import { seedNutrientDefinitions } from '#db/seed/index'
import { createDayDetailService } from '#domain/day-detail/index'
import {
  createFoodBrowseService,
  createFoodSearchService,
} from '#domain/food-browse/index'
import { createFoodDetailService } from '#domain/food-detail/index'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '#domain/food-master/index'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { createMealHistoryService } from '#domain/meal-history/index'
import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import { createDrizzleMealSkipRepository } from '#domain/meal-skip/drizzle-meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import { createDrizzleNutrientDefinitionRepository } from '#domain/nutrient-definition/index'
import { createUserProfileService } from '#domain/user-profile/user-profile-service'
import { EnvError, loadEnv } from '#env'
import { createJsonStdoutLogger } from '#logger'
import { handleMcpRequest } from '#mcp-http'
import type { MeshiToolDeps } from '#mcp-tools'

const LISTEN_ADDR_RE = /^\[([^\]]+)\]:(\d+)$|^([^:]+):(\d+)$/

const parseListenAddr = (addr: string): { hostname: string; port: number } => {
  const match = LISTEN_ADDR_RE.exec(addr)
  const hostname = match?.[1] ?? match?.[3]
  if (match === null || hostname === undefined || hostname === '') {
    // eslint-disable-next-line no-restricted-syntax -- runs at process bootstrap inside main(); src/index.ts's main().catch() is the top-level failure boundary
    throw new EnvError([
      `MCP_LISTEN_ADDR must be "host:port" or "[ipv6]:port" (got: ${addr})`,
    ])
  }
  const port = Number(match[2] ?? match[4])
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    // eslint-disable-next-line no-restricted-syntax -- see comment above
    throw new EnvError([
      `MCP_LISTEN_ADDR port must be a valid TCP port (got: ${addr})`,
    ])
  }
  return { hostname, port }
}

const isMcpRequest = (url: string | undefined): boolean =>
  url === '/mcp' || url?.startsWith('/mcp?') === true

export const main = async (): Promise<void> => {
  const env = loadEnv()
  const sql = createSql(env.DATABASE_URL)
  await pingDb(sql)
  await runMigrations(sql)
  await seedNutrientDefinitions(sql)

  const foodMasterService = createFoodMasterService(
    createFoodMasterRepository(sql),
  )
  const mealLogService = createMealLogService({
    repository: createDrizzleMealLogRepository(sql),
    foodMasterService,
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  })
  const mealSkipService = createMealSkipService({
    repository: createDrizzleMealSkipRepository(sql),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  })
  const foodMatcher = createDrizzleFoodMatcher(sql)
  const foodSearchService = createFoodSearchService(sql, foodMatcher)
  const mealHistoryService = createMealHistoryService(sql)
  const dayDetailService = createDayDetailService(
    sql,
    mealHistoryService,
    mealSkipService,
  )
  const foodBrowseService = createFoodBrowseService(sql, foodMatcher)
  const foodDetailService = createFoodDetailService(sql, foodMasterService)
  const nutrientDefinitionRepository =
    createDrizzleNutrientDefinitionRepository(sql)
  const userProfileService = createUserProfileService(
    createDrizzleUserProfileRepository(sql),
  )
  const logger = createJsonStdoutLogger()
  const toolDeps: MeshiToolDeps = {
    mealHistoryService,
    profileService: userProfileService,
    foodSearchService,
    mealLogService,
    mealSkipService,
    foodMasterService,
    logger,
  }

  const app = createApp({
    sql,
    mealHistoryService,
    dayDetailService,
    nutrientDefinitionRepository,
    userProfileService,
    foodBrowseService,
    foodDetailService,
    mealLogService,
    foodMasterService,
    mealSkipService,
  })
  const honoListener = getRequestListener(app.fetch)

  const server = createServer((req, res) => {
    if (isMcpRequest(req.url)) {
      void handleMcpRequest(req, res, toolDeps)
      return
    }
    void honoListener(req, res)
  })

  const { hostname, port } = parseListenAddr(env.MCP_LISTEN_ADDR)
  server.listen(port, hostname, () => {
    console.log(`meshi listening on ${hostname}:${String(port)}`)
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`received ${signal}, shutting down`)
    server.closeAllConnections()
    server.close((closeErr) => {
      // initObservability also registers its own SIGTERM/SIGINT listener
      // that flushes independently and then re-delivers the signal, which
      // falls through to Node's default disposition (immediate exit) once
      // no listener remains. Awaiting the same handle here can't fully win
      // that race, but it stops this handler's own process.exit() from
      // cutting the flush short in the common case where it finishes first.
      void Promise.allSettled([sql.end({ timeout: 5 })])
        .then(async (results) => {
          for (const result of results) {
            if (result.status === 'rejected') {
              console.error('shutdown error:', result.reason)
              Sentry.captureException(result.reason)
            }
          }
          // Runs after the captures above, not concurrently with them:
          // observability.shutdown() closes the Sentry client, and a
          // captureException call made after close() is silently dropped.
          await observability?.shutdown()
        })
        .finally(() => {
          process.exit(closeErr ? 1 : 0)
        })
    })
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
