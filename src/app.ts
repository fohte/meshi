import type { AgentCard } from '@a2a-js/sdk'
import type { DefaultRequestHandler } from '@a2a-js/sdk/server'
import { Hono } from 'hono'

import { mountA2aRoutes } from '@/a2a/hono-bridge'
import type { Sql } from '@/db'
import { pingDb } from '@/db'

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

  app.get('/health', async (c) => {
    try {
      await pingDb(deps.sql)
      return c.json({ status: 'ok' })
    } catch (err) {
      return c.json({ status: 'error', error: errorMessage(err) }, 503)
    }
  })

  mountA2aRoutes(app, {
    agentCard: deps.agentCard,
    requestHandler: deps.requestHandler,
    ...(deps.bearerToken === undefined
      ? {}
      : { bearerToken: deps.bearerToken }),
  })

  return app
}
