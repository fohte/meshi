import type { IncomingMessage, ServerResponse } from 'node:http'

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'

import { createMcpServer } from '@/mcp'

// Stateless mode: the SDK mandates a fresh transport per request
// (webStandardStreamableHttp.js: "Stateless transport cannot be reused
// across requests"). Bypassing Hono is required because Hono's Node
// adapter writes its own Response after the handler returns, which races
// with the transport that already ended the response stream.
export const handleMcpRequest = async (
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> => {
  const server = createMcpServer()
  const transport = new StreamableHTTPServerTransport({})
  res.on('close', () => {
    void transport.close()
    void server.close()
  })

  try {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- SDK transport widens callback props to include undefined, conflicting with Transport under exactOptionalPropertyTypes.
    await server.connect(transport as unknown as Transport)
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
