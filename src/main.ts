import { createServer } from 'node:http'

import { getRequestListener } from '@hono/node-server'

import { createApp } from '@/app'
import { createSql, pingDb } from '@/db'
import { runMigrations } from '@/db/migrate'
import { seedNutrientDefinitions } from '@/db/seed'
import { EnvError, loadEnv } from '@/env'
import { handleMcpRequest } from '@/mcp-http'

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

  const server = createServer((req, res) => {
    if (isMcpRequest(req.url)) {
      void handleMcpRequest(req, res)
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
      void sql.end({ timeout: 5 }).finally(() => {
        process.exit(closeErr ? 1 : 0)
      })
    })
  }

  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)
}
