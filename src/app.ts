import { Hono } from 'hono'

import type { Sql } from '@/db'
import { pingDb } from '@/db'

export interface AppDeps {
  sql: Sql
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

  return app
}
