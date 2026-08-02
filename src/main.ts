import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

import {
  DefaultPushNotificationSender,
  DefaultRequestHandler,
} from '@a2a-js/sdk/server'
import { createGenAiTracingMiddleware } from '@fohte/service-kit/langchain-genai'
import { getRequestListener } from '@hono/node-server'
import * as Sentry from '@sentry/node'

import { createMeshiAgentCard } from '#a2a/agent-card'
import { createMeshiAgentExecutor } from '#a2a/agent-executor'
import { startTaskLifecycleJobs } from '#a2a/lifecycle-jobs'
import { createPostgresPushNotificationStore } from '#a2a/postgres-push-notification-store'
import { createPostgresTaskStore } from '#a2a/postgres-task-store'
import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import { GEN_AI_PROVIDER_NAME_VALUE_OPENCODE } from '#adapters/llm/index'
import { createTavilyWebSearchClient } from '#adapters/web-search/tavily-web-search-client'
import { createApp } from '#app'
import { observability } from '#bootstrap'
import { createSql, pingDb } from '#db/index'
import { runMigrations } from '#db/migrations'
import { seedNutrientDefinitions } from '#db/seed/index'
import { createDayDetailService } from '#domain/day-detail/index'
import { createFoodBrowseService } from '#domain/food-browse/index'
import { createFoodDetailService } from '#domain/food-detail/index'
import { createFoodMasterRepository } from '#domain/food-master/repository'
import { createFoodMasterService } from '#domain/food-master/service'
import { createFoodMasterUnitRepository } from '#domain/food-master-unit/repository'
import { createFoodMasterUnitService } from '#domain/food-master-unit/service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { createMealHistoryService } from '#domain/meal-history/index'
import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import { createDrizzleMealSkipRepository } from '#domain/meal-skip/drizzle-meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import { createDrizzleNutrientDefinitionRepository } from '#domain/nutrient-definition/index'
import { createUserProfileService } from '#domain/user-profile/user-profile-service'
import { EnvError, loadEnv } from '#env'
import {
  createMeshiChatModel,
  createMeshiCheckpointer,
  createMeshiDomainAgent,
} from '#llm/agent/index'
import { createDomainToolsRegistry } from '#llm/domain-tools/index'
import {
  createDomainAgentOrchestrator,
  createTemplateReplyFormatter,
} from '#llm/orchestrator/index'
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

// Watchdog: a `working` a2a_task whose heartbeat has been silent for longer
// than this is failed. This is a heartbeat timeout, not a max execution
// time — a slow-but-alive executor keeps publishing status-updates and
// never crosses it.
const A2A_WORKING_TIMEOUT_MS = 10 * 60 * 1000
// Retention: a terminal-state a2a_task older than this many days is deleted.
const A2A_TASK_RETENTION_DAYS = 30

export const main = async (): Promise<void> => {
  const env = loadEnv()
  const sql = createSql(env.DATABASE_URL)
  await pingDb(sql)
  await runMigrations(sql)
  await seedNutrientDefinitions(sql)

  const mealLogService = createMealLogService({
    repository: createDrizzleMealLogRepository(sql),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  })
  const foodMasterService = createFoodMasterService(
    createFoodMasterRepository(sql),
  )
  const foodMasterUnitService = createFoodMasterUnitService(
    createFoodMasterUnitRepository(sql),
  )
  const mealSkipService = createMealSkipService({
    repository: createDrizzleMealSkipRepository(sql),
    idGenerator: () => randomUUID(),
    now: () => new Date(),
  })
  const foodMatcher = createDrizzleFoodMatcher(sql)
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
  const webSearchClient = createTavilyWebSearchClient({
    apiKey: env.WEB_SEARCH_API_KEY,
  })
  const registry = createDomainToolsRegistry({
    mealLogService,
    foodMasterService,
    foodMasterUnitService,
    foodMatcher,
    mealHistoryService,
    userProfileService,
    webSearchClient,
    mealSkipService,
  })

  const model = createMeshiChatModel({
    apiKey: env.OPENCODE_API_KEY,
    model: env.MESHI_LLM_MODEL,
  })
  // Built once here, not inside createMeshiDomainAgent: that factory takes
  // an arbitrary BaseChatModel and has no way to know which provider it's
  // actually talking to, whereas main.ts (the composition root) already
  // knows model is OpenCode Go-backed (see createMeshiChatModel above).
  const genAiTracingMiddleware = createGenAiTracingMiddleware({
    providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
    captureMessageContent:
      env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT,
  })
  const checkpointer = createMeshiCheckpointer(env.DATABASE_URL)
  const domainAgent = createMeshiDomainAgent({
    model,
    registry,
    checkpointer,
    middleware: [genAiTracingMiddleware],
  })

  const logger = createJsonStdoutLogger()
  const orchestrator = createDomainAgentOrchestrator({
    model,
    registry,
    formatter: createTemplateReplyFormatter(),
    logger,
    middleware: [genAiTracingMiddleware],
  })
  const toolDeps: MeshiToolDeps = {
    orchestrator,
    profileService: userProfileService,
    logger,
  }

  const agentCard = createMeshiAgentCard({ url: env.A2A_AGENT_URL })
  const taskStore = createPostgresTaskStore(sql)
  const pushNotificationStore = createPostgresPushNotificationStore(sql)
  const pushNotificationSender = new DefaultPushNotificationSender(
    pushNotificationStore,
  )
  const agentExecutor = createMeshiAgentExecutor({
    agent: domainAgent,
    sql,
    logger,
  })
  const requestHandler = new DefaultRequestHandler(
    agentCard,
    taskStore,
    agentExecutor,
    undefined,
    pushNotificationStore,
    pushNotificationSender,
  )

  const app = createApp({
    sql,
    agentCard,
    requestHandler,
    mealHistoryService,
    dayDetailService,
    nutrientDefinitionRepository,
    userProfileService,
    foodBrowseService,
    foodDetailService,
    mealLogService,
    foodMasterService,
    mealSkipService,
    ...(env.A2A_BEARER_TOKEN === undefined
      ? {}
      : { bearerToken: env.A2A_BEARER_TOKEN }),
  })
  const honoListener = getRequestListener(app.fetch)

  const lifecycleJobs = startTaskLifecycleJobs(taskStore, {
    workingTimeoutMs: A2A_WORKING_TIMEOUT_MS,
    retentionDays: A2A_TASK_RETENTION_DAYS,
    onExpire: (task) => pushNotificationSender.send(task),
  })

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
        lifecycleJobs.stop(),
        checkpointer.end(),
        sql.end({ timeout: 5 }),
      ])
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
