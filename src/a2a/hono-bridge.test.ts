import type { AgentCard, Task } from '@a2a-js/sdk'
import type {
  AgentExecutor,
  ExecutionEventBus,
  TaskStore,
} from '@a2a-js/sdk/server'
import { DefaultRequestHandler, InMemoryTaskStore } from '@a2a-js/sdk/server'
import { captureWithFingerprint } from '@fohte/service-kit/observability'
import { Hono } from 'hono'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'

import { mountA2aRoutes } from '@/a2a/hono-bridge'

vi.mock('@fohte/service-kit/observability', () => ({
  captureWithFingerprint: vi.fn(),
}))

afterEach(() => {
  vi.mocked(captureWithFingerprint).mockClear()
})

const HONO_FINGERPRINT = 'a2a.hono.request-failed'

// Full shapes, not `.loose()`: parsed once to confirm every field is
// present with the right type, then the whole (normalized) value is
// compared with a single `toEqual` below — no partial matchers.
const jsonRpcSuccessSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  // ResultManager folds the original user message into `history` for a
  // freshly created task (see DefaultRequestHandler.sendMessage), which
  // this stub executor's own published event never sets directly.
  result: z.object({
    kind: z.literal('task'),
    id: z.string(),
    contextId: z.string(),
    status: z.object({ state: z.string(), timestamp: z.string() }),
    history: z.array(z.unknown()),
  }),
})

const jsonRpcErrorSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.null(),
  error: z.object({ code: z.number(), message: z.string() }),
})

const streamEventSchema = z.object({
  jsonrpc: z.literal('2.0'),
  id: z.number(),
  result: z.object({
    kind: z.literal('task'),
    id: z.string(),
    contextId: z.string(),
    status: z.object({ state: z.string(), timestamp: z.string() }),
  }),
})

const NORMALIZED = 'NORMALIZED'

const normalizeStatusIds = <
  T extends { id: string; contextId: string; status: { timestamp: string } },
>(
  result: T,
): T => ({
  ...result,
  id: NORMALIZED,
  contextId: NORMALIZED,
  status: { ...result.status, timestamp: NORMALIZED },
})

const normalizeTaskResult = (
  body: z.infer<typeof jsonRpcSuccessSchema>,
): z.infer<typeof jsonRpcSuccessSchema> => ({
  ...body,
  result: normalizeStatusIds(body.result),
})

// The exact message text comes from V8's JSON.parse error and isn't stable
// across Node versions, so only its presence is normalized in.
const normalizeParseError = (
  body: z.infer<typeof jsonRpcErrorSchema>,
): z.infer<typeof jsonRpcErrorSchema> => ({
  ...body,
  error: { ...body.error, message: NORMALIZED },
})

const parseSseEvents = (text: string): unknown[] =>
  text
    .split('\n\n')
    .filter((chunk) => chunk.trim() !== '')
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')) as unknown)

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
      expect(normalizeTaskResult(body)).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          kind: 'task',
          id: NORMALIZED,
          contextId: NORMALIZED,
          status: { state: 'completed', timestamp: NORMALIZED },
          history: [
            {
              kind: 'message',
              messageId: 'msg-1',
              role: 'user',
              parts: [{ kind: 'text', text: 'hello' }],
            },
          ],
        },
      })
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
      expect(normalizeParseError(body)).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: NORMALIZED },
      })
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
      const events = parseSseEvents(await res.text()).map((event) => {
        const parsed = streamEventSchema.parse(event)
        return { ...parsed, result: normalizeStatusIds(parsed.result) }
      })
      expect(events).toEqual([
        {
          jsonrpc: '2.0',
          id: 1,
          result: {
            kind: 'task',
            id: NORMALIZED,
            contextId: NORMALIZED,
            status: { state: 'completed', timestamp: NORMALIZED },
          },
        },
      ])
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

  describe('error reporting', () => {
    // Neither jsonRpcTransportHandler.handle (the SDK catches its own
    // internal errors) nor the routes below throw in practice, so this
    // exercises app.onError the same way any other route sharing the app
    // (e.g. GET /health in src/app.ts) would.
    it('reports to Sentry and returns a JSON-RPC error response when a route throws', async () => {
      const app = buildApp()
      const thrown = new Error('boom')
      app.get('/boom', () => {
        throw thrown
      })

      const res = await app.request('/boom')

      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'boom' },
      })
      expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
        thrown,
        HONO_FINGERPRINT,
      )
    })

    it('reports to Sentry and emits an SSE error event when the stream fails', async () => {
      const thrown = new Error('task store unavailable')
      const failingTaskStore: TaskStore = {
        save: () => Promise.reject(thrown),
        load: () => Promise.resolve(undefined),
      }
      const requestHandler = new DefaultRequestHandler(
        buildAgentCard(),
        failingTaskStore,
        completingExecutor,
      )
      const app = new Hono()
      mountA2aRoutes(app, { agentCard: buildAgentCard(), requestHandler })

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
              messageId: 'msg-stream-fail',
              role: 'user',
              parts: [{ kind: 'text', text: 'hello' }],
            },
          },
        }),
      })

      expect(res.status).toBe(200)
      expect(res.headers.get('Content-Type')).toBe('text/event-stream')
      const dataLine = (await res.text())
        .split('\n')
        .find((line) => line.startsWith('data: '))
      expect(
        dataLine === undefined
          ? undefined
          : JSON.parse(dataLine.slice('data: '.length)),
      ).toEqual({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32603, message: 'task store unavailable' },
      })
      expect(captureWithFingerprint).toHaveBeenCalledExactlyOnceWith(
        thrown,
        HONO_FINGERPRINT,
      )
    })
  })
})
