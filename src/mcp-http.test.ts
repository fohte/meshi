import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { handleMcpRequest } from '@/mcp-http'
import { createStubMcpDeps } from '@/test/mcp-stubs'

const stubDeps = createStubMcpDeps()

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
  })

  it('responds to a JSON-RPC initialize over real HTTP', async () => {
    const started = await start()
    server = started.server

    const res = await fetch(started.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'smoke', version: '0' },
        },
      }),
    })

    expect(res.status).toBe(200)
    expect(parseSseDataLine(await res.text())).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: true } },
        serverInfo: { name: 'meshi', version: '0.0.0' },
      },
    })
  })
})
