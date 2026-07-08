import type { IncomingMessage, ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { trace } from '@opentelemetry/api'
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_MCP_METHOD_NAME,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  MCP_METHOD_NAME_VALUE_TOOLS_CALL,
} from '@opentelemetry/semantic-conventions/incubating'
import { z } from 'zod'

import { createMcpServer } from '@/mcp'
import type { MeshiToolDeps } from '@/mcp-tools'

// Stateless mode: the SDK mandates a fresh transport per request
// (webStandardStreamableHttp.js: "Stateless transport cannot be reused
// across requests"). Bypassing Hono is required because Hono's Node
// adapter writes its own Response after the handler returns, which races
// with the transport that already ended the response stream.
export const handleMcpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: MeshiToolDeps,
): Promise<void> => {
  const server = createMcpServer(deps)
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK transport widens callback props to include undefined, conflicting with Transport under exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport)

    // Only JSON POST bodies carry a JSON-RPC message; anything else (wrong
    // Content-Type, GET/DELETE for the SSE stream and session lifecycle) is
    // left for the SDK to read and reject/handle itself, so a client sending
    // a bad Content-Type still gets rejected without its body being read.
    if (
      req.method === 'POST' &&
      isJsonContentType(req.headers['content-type'])
    ) {
      const parsedBody = await readJsonRpcBody(req)
      annotateSpanForJsonRpcRequest(parsedBody)
      await transport.handleRequest(req, res, parsedBody)
      return
    }

    await transport.handleRequest(req, res)
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          error: err instanceof Error ? err.message : String(err),
        }),
      )
      return
    }
    res.destroy(err instanceof Error ? err : new Error(String(err)))
  }
}

const isJsonContentType = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.includes('application/json')

// The SDK reads the body itself via `transport.handleRequest`, so it's
// buffered here instead and fed back through `handleRequest`'s `parsedBody`
// param (the mechanism the SDK documents for body-parser middleware) to
// avoid reading the request stream twice.
const readJsonRpcBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  try {
    return JSON.parse(raw) as unknown
  } catch {
    // Malformed JSON: hand the raw text through so the SDK's own JSON-RPC
    // validation rejects it too (its exact error message differs from the
    // one it produces for a JSON parse failure, but both are 400s with a
    // JSON-RPC parse-error code).
    return raw
  }
}

// Only messages that could plausibly reach a tool handler are used to name
// the span — matching the `jsonrpc: "2.0"` envelope the SDK itself requires
// keeps span names representative of requests the SDK actually processes,
// rather than being derived from bodies it will go on to reject.
// Length-capped: these values flow straight into the span name/attributes,
// and /mcp has no auth in front of it, so an unbounded string here would let
// any client inflate span cardinality/payload size in the telemetry backend.
const jsonRpcCallSchema = z.object({
  jsonrpc: z.literal('2.0'),
  method: z.string().max(128),
  params: z
    .object({ name: z.string().max(128) })
    .partial()
    .optional(),
})

// Batched JSON-RPC requests (an array body) are rare for MCP clients, which
// send one call per HTTP request; only the first message is used to name
// the span rather than trying to represent every method in the batch.
const annotateSpanForJsonRpcRequest = (body: unknown): void => {
  const parsed = jsonRpcCallSchema.safeParse(
    Array.isArray(body) ? body[0] : body,
  )
  if (!parsed.success) return

  const span = trace.getActiveSpan()
  if (span === undefined) return

  const { method, params } = parsed.data
  const toolName =
    method === MCP_METHOD_NAME_VALUE_TOOLS_CALL ? params?.name : undefined

  span.updateName(toolName === undefined ? method : `${method} ${toolName}`)
  span.setAttributes({
    [ATTR_MCP_METHOD_NAME]: method,
    ...(toolName === undefined
      ? {}
      : {
          [ATTR_GEN_AI_TOOL_NAME]: toolName,
          [ATTR_GEN_AI_OPERATION_NAME]:
            GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
        }),
  })
}
