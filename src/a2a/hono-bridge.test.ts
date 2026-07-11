import type { AgentCard, Task } from '@a2a-js/sdk'
import type { AgentExecutor, ExecutionEventBus } from '@a2a-js/sdk/server'
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server'
import { Hono } from 'hono'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mountA2aRoutes } from '@/a2a/hono-bridge'

const jsonRpcSuccessSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.string(), z.number(), z.null()]),
  result: z
    .object({
      kind: z.string(),
      status: z.object({ state: z.string() }).loose(),
    })
    .loose(),
})

const jsonRpcErrorSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.string(), z.number(), z.null()]),
  error: z.object({ code: z.number() }).loose(),
})

const AGENT_CARD_URL = '/.well-known/agent-card.json'

const buildAgentCard = (overrides: Partial<AgentCard> = {}): AgentCard => ({
  protocolVersion: '0.3.0',
  name: 'meshi-test-agent',
  description: 'test fixture agent card',
  url: 'http://localhost/a2a',
  version: '0.0.0',
  capabilities: { streaming: true },
  defaultInputModes: ['text/plain'],
  defaultOutputModes: ['text/plain'],
  skills: [],
  ...overrides,
})

// Completes the task with a single `task` event, which is enough for a
// blocking message/send to resolve (DefaultRequestHandler resolves on the
// first task/message event, not on `finished()`).
const completingExecutor: AgentExecutor = {
  execute(requestContext, eventBus: ExecutionEventBus) {
    const task: Task = {
      kind: 'task',
      id: requestContext.taskId,
      contextId: requestContext.contextId,
      status: { state: 'completed', timestamp: new Date().toISOString() },
    }
    eventBus.publish(task)
    eventBus.finished()
    return Promise.resolve()
  },
  cancelTask() {
    return Promise.resolve()
  },
}

const buildMessageSendBody = (id: string) =>
  JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'message/send',
    params: {
      message: {
        kind: 'message',
        messageId: id,
        role: 'user',
        parts: [{ kind: 'text', text: 'hello' }],
      },
    },
  })

const buildApp = (options: { bearerToken?: string } = {}): Hono => {
  const requestHandler = new DefaultRequestHandler(
    buildAgentCard(),
    new InMemoryTaskStore(),
    completingExecutor,
  )
  const app = new Hono()
  mountA2aRoutes(app, {
    agentCard: buildAgentCard(),
    requestHandler,
    ...(options.bearerToken !== undefined
      ? { bearerToken: options.bearerToken }
      : {}),
  })
  return app
}

describe('mountA2aRoutes', () => {
  describe('without a bearer token configured', () => {
    it('serves the agent card', async () => {
      const app = buildApp()
      const res = await app.request(AGENT_CARD_URL)

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual(buildAgentCard())
    })

    it('handles a blocking message/send over JSON-RPC', async () => {
      const app = buildApp()
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: buildMessageSendBody('msg-1'),
      })

      expect(res.status).toBe(200)
      const body = jsonRpcSuccessSchema.parse(await res.json())
      expect(body.result.kind).toBe('task')
      expect(body.result.status.state).toBe('completed')
    })

    it('returns a JSON-RPC parse error for a malformed body', async () => {
      const app = buildApp()
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      })

      expect(res.status).toBe(200)
      const body = jsonRpcErrorSchema.parse(await res.json())
      expect(body.error.code).toBe(-32700)
    })

    it('streams message/stream as SSE', async () => {
      const app = buildApp()
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'message/stream',
          params: {
            message: {
              kind: 'message',
              messageId: 'msg-stream',
              role: 'user',
              parts: [{ kind: 'text', text: 'hello' }],
            },
          },
        }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/event-stream')
      const text = await res.text()
      expect(text).toContain('"kind":"task"')
      expect(text).toContain('"state":"completed"')
    })
  })

  describe('with a bearer token configured', () => {
    it('rejects requests missing the Authorization header', async () => {
      const app = buildApp({ bearerToken: 'secret-token' })
      const res = await app.request(AGENT_CARD_URL)

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    })

    it('rejects requests with the wrong token', async () => {
      const app = buildApp({ bearerToken: 'secret-token' })
      const res = await app.request('/a2a', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer wrong-token',
        },
        body: buildMessageSendBody('msg-2'),
      })

      expect(res.status).toBe(401)
    })

    it('accepts requests with the correct token', async () => {
      const app = buildApp({ bearerToken: 'secret-token' })
      const res = await app.request(AGENT_CARD_URL, {
        headers: { Authorization: 'Bearer secret-token' },
      })

      expect(res.status).toBe(200)
    })
  })
})
