import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { handleMcpRequest } from '@/mcp-http'
import { createStubMcpDeps } from '@/test/mcp-stubs'

const stubDeps = createStubMcpDeps()

// A real tracer, so the finished span's name/attributes can be asserted
// directly instead of inspecting mock call args.
const spanExporter = new InMemorySpanExporter()
const tracerProvider = new BasicTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(spanExporter)],
})
const tracer = tracerProvider.getTracer('mcp-http.test')

const postJsonRpc = (
  url: string,
  body: Readonly<Record<string, unknown>>,
): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify(body),
  })

const start = async (): Promise<{ server: Server; url: string }> => {
  const server = createServer((req, res) => {
    void handleMcpRequest(req, res, stubDeps)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    throw new Error('expected AddressInfo from server.address()')
  }
  const port: number = (addr satisfies AddressInfo).port
  return { server, url: `http://127.0.0.1:${String(port)}/mcp` }
}

const stop = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((err) => {
      if (err === undefined) resolve()
      else reject(err)
    })
  })

const parseSseDataLine = (text: string): unknown => {
  const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
  if (dataLine === undefined) throw new Error(`no SSE data line in: ${text}`)
  return JSON.parse(dataLine.slice('data: '.length))
}

describe('handleMcpRequest', () => {
  let server: Server | undefined

  afterEach(async () => {
    if (server !== undefined) {
      const s = server
      server = undefined
      await stop(s)
    }
    vi.restoreAllMocks()
    spanExporter.reset()
  })

  it('responds to a JSON-RPC initialize over real HTTP', async () => {
    const started = await start()
    server = started.server

    const res = await postJsonRpc(started.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    })

    expect({
      status: res.status,
      payload: parseSseDataLine(await res.text()),
    }).toEqual({
      status: 200,
      payload: {
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: { listChanged: true } },
          serverInfo: { name: 'meshi', version: '0.0.0' },
        },
      },
    })
  })

  it('renames the active span with the JSON-RPC method and tool name for tools/call', async () => {
    const started = await start()
    server = started.server
    const span = tracer.startSpan('POST')
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span)

    await postJsonRpc(started.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'record_meal_from_text',
        arguments: { text: 'ラーメン' },
      },
    })
    span.end()

    expect(
      spanExporter
        .getFinishedSpans()
        .map((s) => ({ name: s.name, attributes: s.attributes })),
    ).toEqual([
      {
        name: 'tools/call record_meal_from_text',
        attributes: {
          'mcp.method.name': 'tools/call',
          'gen_ai.tool.name': 'record_meal_from_text',
          'gen_ai.operation.name': 'execute_tool',
        },
      },
    ])
  })

  it('renames the active span with only the JSON-RPC method when there is no tool target', async () => {
    const started = await start()
    server = started.server
    const span = tracer.startSpan('POST')
    vi.spyOn(trace, 'getActiveSpan').mockReturnValue(span)

    await postJsonRpc(started.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke', version: '0' },
      },
    })
    span.end()

    expect(
      spanExporter
        .getFinishedSpans()
        .map((s) => ({ name: s.name, attributes: s.attributes })),
    ).toEqual([
      {
        name: 'initialize',
        attributes: {
          'mcp.method.name': 'initialize',
        },
      },
    ])
  })
})
