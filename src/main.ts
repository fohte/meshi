import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import { getRequestListener } from '@hono/node-server'

import { createDrizzleUserProfileRepository } from '@/adapters/db/drizzle-user-profile-repository'
import { OpenCodeLlmClient } from '@/adapters/llm'
import { createTavilyWebSearchClient } from '@/adapters/web-search/tavily-web-search-client'
import { createApp } from '@/app'
import { observability } from '@/bootstrap'
import { createSql, pingDb } from '@/db'
import { runMigrations } from '@/db/migrations'
import { seedNutrientDefinitions } from '@/db/seed'
import { createFoodMasterRepository } from '@/domain/food-master/repository'
import { createFoodMasterService } from '@/domain/food-master/service'
import { createDrizzleFoodMatcher } from '@/domain/food-matcher'
import { createMealHistoryService } from '@/domain/meal-history'
import { createDrizzleMealLogRepository } from '@/domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '@/domain/meal-log/meal-log-service'
import { createUserProfileService } from '@/domain/user-profile/user-profile-service'
import { EnvError, loadEnv } from '@/env'
import { createDomainToolsRegistry } from '@/llm/domain-tools'
import {
  createConversationOrchestrator,
  createTemplateReplyFormatter,
} from '@/llm/orchestrator'
import { createJsonStdoutLogger } from '@/logger'
import { handleMcpRequest } from '@/mcp-http'
import type { MeshiToolDeps } from '@/mcp-tools'

const LISTEN_ADDR_RE = /^\[([^\]]+)\]:(\d+)$|^([^:]+):(\d+)$/

const parseListenAddr = (addr: string): { hostname: string; port: number } => {
  const match = LISTEN_ADDR_RE.exec(addr)
  const hostname = match?.[1] ?? match?.[3]
  if (match === null || hostname === undefined || hostname === '') {
    throw new EnvError([
      `MCP_LISTEN_ADDR must be "host:port" or "[ipv6]:port" (got: ${addr})`,
    ])
  }
  const port = Number(match[2] ?? match[4])
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
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

  const app = createApp({ sql })
  const honoListener = getRequestListener(app.fetch)

  const mealLogService = createMealLogService({
    repository: createDrizzleMealLogRepository(sql),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  })
  const foodMasterService = createFoodMasterService(
    createFoodMasterRepository(sql),
  )
  const foodMatcher = createDrizzleFoodMatcher(sql)
  const mealHistoryService = createMealHistoryService(sql)
  const userProfileService = createUserProfileService(
    createDrizzleUserProfileRepository(sql),
  )
  const webSearchClient = createTavilyWebSearchClient({
    apiKey: env.WEB_SEARCH_API_KEY,
  })
  const llmClient = new OpenCodeLlmClient({ apiKey: env.OPENCODE_API_KEY })
  const registry = createDomainToolsRegistry({
    mealLogService,
    foodMasterService,
    foodMatcher,
    mealHistoryService,
    userProfileService,
    webSearchClient,
  })
  const orchestrator = createConversationOrchestrator({
    llmClient,
    registry,
    textModel: env.MESHI_LLM_MODEL,
    visionModel: env.MESHI_LLM_VISION_MODEL,
    maxTurns: env.MESHI_LLM_MAX_TURNS,
    formatter: createTemplateReplyFormatter(),
  })
  const toolDeps: MeshiToolDeps = {
    orchestrator,
    profileService: userProfileService,
    logger: createJsonStdoutLogger(),
  }

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
      void Promise.allSettled([
        sql.end({ timeout: 5 }),
        observability?.shutdown(),
      ])
        .then((results) => {
          for (const result of results) {
            if (result.status === 'rejected') {
              console.error('shutdown error:', result.reason)
            }
          }
        })
        .finally(() => {
          process.exit(closeErr ? 1 : 0)
        })
    })
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
