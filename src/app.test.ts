import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { describe, expect, it } from 'vitest'

import { createApp } from '#app'
import type { Sql } from '#db/index'
import { createMcpServer } from '#mcp'
import { createStubApiDeps } from '#test/api-stubs'
import { createStubMcpDeps } from '#test/mcp-stubs'

const fakeSql = (
  tag: (strings: TemplateStringsArray) => Promise<unknown[]>,
): Sql =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Sql is a callable tag; tests only exercise the SELECT 1 ping branch.
  tag as unknown as Sql

describe('createApp', () => {
  it('returns ok on /health after a successful DB ping', async () => {
    const queries: string[][] = []
    const sql = fakeSql((strings) => {
      queries.push(Array.from(strings))
      return Promise.resolve([])
    })
    const res = await createApp({
      sql,
      ...createStubApiDeps(),
    }).request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(queries).toEqual([['SELECT 1']])
  })

  it('returns 503 on /health when the DB ping fails', async () => {
    const sql = fakeSql(() => Promise.reject(new Error('connection refused')))
    const res = await createApp({
      sql,
      ...createStubApiDeps(),
    }).request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'error',
      error: 'connection refused',
    })
  })

  it('does not mount the removed A2A routes', () => {
    const sql = fakeSql(() => Promise.resolve([]))
    const app = createApp({ sql, ...createStubApiDeps() })

    const removedRoutePaths = app.routes
      .map((route) => route.path)
      .filter(
        (path) => path === '/.well-known/agent-card.json' || path === '/a2a',
      )
    expect(removedRoutePaths).toEqual([])
  })

  it('mounts the /api routes', async () => {
    const sql = fakeSql(() => Promise.resolve([]))
    const res = await createApp({
      sql,
      ...createStubApiDeps(),
    }).request('/api/nutrient-definitions')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([])
  })
})

describe('MCP server initialize', () => {
  it('responds with the meshi server identity over an in-memory transport', async () => {
    const server = createMcpServer(createStubMcpDeps())
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    const client = new Client({ name: 'meshi-test', version: '0.0.0' })
    await client.connect(clientTransport)

    expect(client.getServerVersion()).toEqual({
      name: 'meshi',
      version: '0.0.0',
    })
    expect(client.getServerCapabilities()).toEqual({
      tools: { listChanged: true },
    })

    await client.close()
    await server.close()
  })
})
