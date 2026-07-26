import type { AgentCard } from '@a2a-js/sdk'
import type { DefaultRequestHandler } from '@a2a-js/sdk/server'
import { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'

import { mountA2aRoutes } from '#a2a/hono-bridge'
import type { Sql } from '#db/index'
import { pingDb } from '#db/index'

export interface AppDeps {
  sql: Sql
  agentCard: AgentCard
  requestHandler: DefaultRequestHandler
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

  return app
}
