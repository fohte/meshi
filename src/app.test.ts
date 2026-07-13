import type { AgentCard } from '@a2a-js/sdk'
import type { AgentExecutor } from '@a2a-js/sdk/server'
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import { createApp } from '@/app'
import type { Sql } from '@/db'
import { createMcpServer, MCP_SERVER_NAME, MCP_SERVER_VERSION } from '@/mcp'
import { createStubMcpDeps } from '@/test/mcp-stubs'

const fakeSql = (
  tag: (strings: TemplateStringsArray) => Promise<unknown[]>,
): Sql =>
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Sql is a callable tag; tests only exercise the SELECT 1 ping branch.
  tag as unknown as Sql

const buildAgentCard = (): AgentCard => ({
  protocolVersion: '0.3.0',
  name: 'meshi-test-agent',
  description: 'test fixture agent card',
  url: 'http://localhost/a2a',
  version: '0.0.0',
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
})

const noopExecutor: AgentExecutor = {
  execute() {
    return Promise.resolve()
  },
  cancelTask() {
    return Promise.resolve()
  },
}

const buildRequestHandler = (agentCard: AgentCard): DefaultRequestHandler =>
  new DefaultRequestHandler(agentCard, new InMemoryTaskStore(), noopExecutor)

describe('createApp', () => {
  it('returns ok on /health after a successful DB ping', async () => {
    const queries: string[][] = []
    const sql = fakeSql((strings) => {
      queries.push(Array.from(strings))
      return Promise.resolve([])
    })
    const agentCard = buildAgentCard()

    const res = await createApp({
      sql,
      agentCard,
      requestHandler: buildRequestHandler(agentCard),
    }).request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
    expect(queries).toEqual([['SELECT 1']])
  })

  it('returns 503 on /health when the DB ping fails', async () => {
    const sql = fakeSql(() => Promise.reject(new Error('connection refused')))
    const agentCard = buildAgentCard()

    const res = await createApp({
      sql,
      agentCard,
      requestHandler: buildRequestHandler(agentCard),
    }).request('/health')
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({
      status: 'error',
      error: 'connection refused',
    })
  })

  it('serves the agent card via the mounted A2A routes', async () => {
    const sql = fakeSql(() => Promise.resolve([]))
    const agentCard = buildAgentCard()

    const res = await createApp({
      sql,
      agentCard,
      requestHandler: buildRequestHandler(agentCard),
    }).request('/.well-known/agent-card.json')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(agentCard)
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
      name: MCP_SERVER_NAME,
      version: MCP_SERVER_VERSION,
    })
    expect(client.getServerCapabilities()).toEqual({
      tools: { listChanged: true },
    })

    await client.close()
    await server.close()
  })
})
