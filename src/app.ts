import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { Hono } from 'hono'

import type { Sql } from '@/db'
import { pingDb } from '@/db'
import { createMcpServer } from '@/mcp'

export interface AppDeps {
  sql: Sql
  createMcpServer?: () => McpServer
}

interface NodeEnv {
  Bindings: {
    incoming: import('node:http').IncomingMessage
    outgoing: import('node:http').ServerResponse
  }
}

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : String(err)

export const createApp = (deps: AppDeps): Hono<NodeEnv> => {
  const app = new Hono<NodeEnv>()
  const makeMcpServer = deps.createMcpServer ?? createMcpServer

  app.get('/health', async (c) => {
    try {
      await pingDb(deps.sql)
      return c.json({ status: 'ok' })
    } catch (err) {
      return c.json({ status: 'error', error: errorMessage(err) }, 503)
    }
  })

  app.all('/mcp', async (c) => {
    const server = makeMcpServer()
    const transport = new StreamableHTTPServerTransport({})
    c.env.outgoing.on('close', () => {
      void transport.close()
      void server.close()
    })
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK transport widens callback props to include undefined, conflicting with Transport under exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport)

    let body: unknown
    if (c.req.method === 'POST') {
      try {
        body = await c.req.json()
      } catch {
        body = undefined
      }
    }
    await transport.handleRequest(c.env.incoming, c.env.outgoing, body)
    return c.body(null)
  })

  return app
}
