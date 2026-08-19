import type { IncomingMessage, ServerResponse } from 'node:http'

import { toNodeHandler } from '@modelcontextprotocol/node'
import { createMcpHandler } from '@modelcontextprotocol/server'
import { trace } from '@opentelemetry/api'
import {
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_TOOL_NAME,
  ATTR_MCP_METHOD_NAME,
  GEN_AI_OPERATION_NAME_VALUE_EXECUTE_TOOL,
  MCP_METHOD_NAME_VALUE_TOOLS_CALL,
} from '@opentelemetry/semantic-conventions/incubating'
import { z } from 'zod'

import { parseJson } from '#lib/json'
import { createMcpServer } from '#mcp'
import type { MeshiToolDeps } from '#mcp-tools'

// Bypassing Hono (see main.ts's isMcpRequest routing) is required because
// Hono's Node adapter writes its own Response after the handler returns,
// which would race with toNodeHandler's writes to `res` below.
export const handleMcpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
  deps: MeshiToolDeps,
): Promise<void> => {
  const nodeHandler = toNodeHandler(
    createMcpHandler(() => createMcpServer(deps)),
  )
  // IncomingMessage types `method` as `string | undefined`, which conflicts
  // with NodeIncomingMessageLike's `method?: string` under
  // exactOptionalPropertyTypes even though a request handed to this HTTP
  // server callback always has `method` set.
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- see comment above
  const nodeReq = req as unknown as Parameters<typeof nodeHandler>[0]

  // Only JSON POST bodies carry a JSON-RPC message; anything else (wrong
  // Content-Type, GET/DELETE for the SSE stream and session lifecycle) is
  // left for the handler to read and reject/handle itself, so a client
  // sending a bad Content-Type still gets rejected without its body being
  // read.
  if (req.method === 'POST' && isJsonContentType(req.headers['content-type'])) {
    // eslint-disable-next-line no-restricted-syntax -- readJsonRpcBody reads the raw request stream outside toNodeHandler's own try/catch; a client disconnecting mid-request rejects the read, and this handler runs fire-and-forget (no `.catch()`) from main.ts, so an uncaught rejection here would crash the whole process under Node's unhandledRejection default
    try {
      const parsedBody = await readJsonRpcBody(req)
      annotateSpanForJsonRpcRequest(parsedBody)
      await nodeHandler(nodeReq, res, parsedBody)
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
    return
  }

  await nodeHandler(nodeReq, res)
}

const isJsonContentType = (contentType: string | undefined): boolean =>
  contentType !== undefined && contentType.includes('application/json')

// The handler reads the body itself when no parsedBody is given, so it's
// buffered here instead and fed back through toNodeHandler's `parsedBody`
// param (the mechanism it documents for a body parser that already consumed
// the stream) to avoid reading the request stream twice.
const readJsonRpcBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    if (Buffer.isBuffer(chunk)) chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf-8')
  // Malformed JSON: hand the raw text through so the handler's own
  // classification rejects it too, rather than silently dropping the body
  // (parsedBody must be defined here, since the stream is already consumed).
  return parseJson(raw).unwrapOr(raw)
}

// Only messages that could plausibly reach a tool handler are used to name
// the span — matching the `jsonrpc: "2.0"` envelope the handler itself
// requires keeps span names representative of requests it actually
// processes, rather than being derived from bodies it will go on to reject.
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
