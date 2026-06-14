import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createApp } from '@/app'
import type { Sql } from '@/db'
import { createMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@/mcp'

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

    const res = await createApp({ sql }).request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(queries).toEqual([['SELECT 1']])
  })

  it('returns 503 on /health when the DB ping fails', async () => {
    const sql = fakeSql(() => Promise.reject(new Error('connection refused')))
    const res = await createApp({ sql }).request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'error',
      error: 'connection refused',
    })
  })
})

describe('MCP server initialize', () => {
  it('responds with the meshi server identity over an in-memory transport', async () => {
    const server = createMcpServer()
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair()
    await server.connect(serverTransport)

    const client = new Client({ name: 'meshi-test', version: '0.0.0' })
    await client.connect(clientTransport)

    expect({
      version: client.getServerVersion(),
      capabilities: client.getServerCapabilities(),
    }).toEqual({
      version: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
      capabilities: { tools: {} },
    })

    await client.close()
    await server.close()
  })
})
