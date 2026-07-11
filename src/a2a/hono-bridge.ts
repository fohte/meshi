import { createHash, timingSafeEqual } from 'node:crypto'

import type { AgentCard, JSONRPCResponse } from '@a2a-js/sdk'
import { AGENT_CARD_PATH } from '@a2a-js/sdk'
import type { DefaultRequestHandler } from '@a2a-js/sdk/server'
import { JsonRpcTransportHandler } from '@a2a-js/sdk/server'
import type { Hono, MiddlewareHandler } from 'hono'
import { streamSSE } from 'hono/streaming'

export interface A2aHonoBridgeOptions {
  agentCard: AgentCard
  requestHandler: DefaultRequestHandler
  // Simple in-cluster auth layered on top of NetworkPolicy, not a
  // replacement for it. Both routes below are open when unset.
  bearerToken?: string
}

const JSON_RPC_PATH = '/a2a'
const BEARER_PREFIX = 'Bearer '

const digest = (value: string): Buffer =>
  createHash('sha256').update(value).digest()

// Compares fixed-length digests instead of the raw strings so neither the
// token's length nor its content leak through response timing.
const isValidBearerToken = (
  header: string | undefined,
  expected: string,
): boolean => {
  if (header === undefined || !header.startsWith(BEARER_PREFIX)) return false
  const provided = header.slice(BEARER_PREFIX.length)
  return timingSafeEqual(digest(provided), digest(expected))
}

const bearerAuthMiddleware = (
  bearerToken: string | undefined,
): MiddlewareHandler => {
  return async (c, next) => {
    if (
      bearerToken !== undefined &&
      !isValidBearerToken(c.req.header('Authorization'), bearerToken)
    ) {
      return c.json({ error: 'unauthorized' }, 401)
    }
    return next()
  }
}

const isAsyncGenerator = (
  value: JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>,
): value is AsyncGenerator<JSONRPCResponse, void, undefined> =>
  Symbol.asyncIterator in value

const internalErrorResponse = (err: unknown): JSONRPCResponse => ({
  jsonrpc: '2.0',
  id: null,
  error: {
    code: -32603,
    message: err instanceof Error ? err.message : String(err),
  },
})

// Hono bridge for the A2A protocol surface: agent card discovery (GET) and
// JSON-RPC (POST), both optionally gated by a bearer token. The JSON-RPC
// route is a thin adapter over the SDK's own transport-agnostic
// JsonRpcTransportHandler, branching only on whether it returned a single
// response or a streaming one (message/stream, tasks/resubscribe).
export const mountA2aRoutes = (
  app: Hono,
  options: A2aHonoBridgeOptions,
): void => {
  const { agentCard, requestHandler, bearerToken } = options
  const jsonRpcTransportHandler = new JsonRpcTransportHandler(requestHandler)
  const auth = bearerAuthMiddleware(bearerToken)

  app.get(`/${AGENT_CARD_PATH}`, auth, (c) => c.json(agentCard))

  app.post(JSON_RPC_PATH, auth, async (c) => {
    // Passed through as raw text (not pre-parsed JSON): the SDK's own
    // handler does the JSON.parse and turns a malformed body into a
    // proper JSON-RPC parse-error response instead of this route throwing.
    const body = await c.req.text()

    let result:
      JSONRPCResponse | AsyncGenerator<JSONRPCResponse, void, undefined>
    try {
      result = await jsonRpcTransportHandler.handle(body)
    } catch (err) {
      console.error('a2a JSON-RPC request failed:', err)
      return c.json(internalErrorResponse(err), 500)
    }

    if (!isAsyncGenerator(result)) {
      return c.json(result)
    }

    const stream = result
    return streamSSE(c, async (sse) => {
      try {
        for await (const event of stream) {
          await sse.writeSSE({ data: JSON.stringify(event) })
        }
      } catch (err) {
        console.error('a2a JSON-RPC stream failed:', err)
        await sse.writeSSE({
          event: 'error',
          data: JSON.stringify(internalErrorResponse(err)),
        })
      }
    })
  })
}
