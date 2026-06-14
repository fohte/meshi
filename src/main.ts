import { serve } from '@hono/node-server'

import { createApp } from '@/app'
import { createSql, pingDb } from '@/db'
import { loadEnv } from '@/env'

const LISTEN_ADDR_RE = /^\[([^\]]+)\]:(\d+)$|^([^:]+):(\d+)$/

const parseListenAddr = (addr: string): { hostname: string; port: number } => {
  const match = LISTEN_ADDR_RE.exec(addr)
  if (match === null) {
    throw new Error(
      `MCP_LISTEN_ADDR must be "host:port" or "[ipv6]:port" (got: ${addr})`,
    )
  }
  const hostname = match[1] ?? match[3] ?? ''
  const port = Number(match[2] ?? match[4])
  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(
      `MCP_LISTEN_ADDR port must be a valid TCP port (got: ${addr})`,
    )
  }
  return { hostname, port }
}

export const main = async (): Promise<void> => {
  const env = loadEnv()
  const sql = createSql(env.DATABASE_URL)
  await pingDb(sql)

  const app = createApp({ sql })
  const { hostname, port } = parseListenAddr(env.MCP_LISTEN_ADDR)

  const server = serve({ fetch: app.fetch, hostname, port }, (info) => {
    console.log(`meshi listening on ${info.address}:${String(info.port)}`)
  })

  const shutdown = (signal: NodeJS.Signals): void => {
    console.log(`received ${signal}, shutting down`)
    server.close((closeErr) => {
      void sql.end({ timeout: 5 }).finally(() => {
        process.exit(closeErr ? 1 : 0)
      })
    })
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
