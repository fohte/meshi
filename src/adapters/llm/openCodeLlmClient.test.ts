import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import {
  OpenCodeLlmClient,
  OpenCodeLlmInvalidResponseError,
} from '@/adapters/llm/openCodeLlmClient'
import type {
  LlmMessage,
  LlmToolCall,
  LlmToolSchema,
} from '@/adapters/llm/types'

interface RecordedRequest {
  readonly path: string
  readonly authorization: string | undefined
  readonly body: unknown
}

interface MockServer {
  readonly url: string
  readonly requests: RecordedRequest[]
  close(): Promise<void>
}

const parseJson = (text: string): unknown => JSON.parse(text) as unknown

const firstHeader = (
  value: string | string[] | undefined,
): string | undefined => (Array.isArray(value) ? value[0] : value)

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'))
    })
    req.on('error', reject)
  })

const startMockServer = async (
  responses: ReadonlyArray<Record<string, unknown>>,
): Promise<MockServer> => {
  const requests: RecordedRequest[] = []
  let index = 0
  const server: Server = createServer((req, res) => {
    void (async (): Promise<void> => {
      const body = await readBody(req)
      requests.push({
        path: req.url ?? '',
        authorization: firstHeader(req.headers.authorization),
        body: parseJson(body),
      })
      const response = responses[index] ?? responses[responses.length - 1]
      index++
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify(response))
    })()
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  const addr = server.address()
  if (addr === null || typeof addr === 'string') {
    throw new Error('expected AddressInfo from server.address()')
  }
  const port = (addr satisfies AddressInfo).port
  return {
    url: `http://127.0.0.1:${String(port)}/v1`,
    requests,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err === undefined) resolve()
          else reject(err)
        })
      }),
  }
}

const tool: LlmToolSchema = {
  name: 'search_food_master',
  description: 'search foods',
  inputSchema: {
    type: 'object',
    properties: { query: { type: 'string' } },
    required: ['query'],
  },
}

const initialMessages: ReadonlyArray<LlmMessage> = [
  { role: 'user', content: [{ type: 'text', text: 'I ate ramen' }] },
]

describe('OpenCodeLlmClient.runConversation', () => {
  let mock: MockServer | undefined

  afterEach(async () => {
    if (mock !== undefined) {
      const m = mock
      mock = undefined
      await m.close()
    }
  })

  it('drives a tool_use → tool_result → final response round trip', async () => {
    mock = await startMockServer([
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_1',
                  type: 'function',
                  function: {
                    name: 'search_food_master',
                    arguments: JSON.stringify({ query: 'ramen' }),
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Logged ramen.' },
          },
        ],
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'test-key',
      baseUrl: mock.url,
    })
    const executed: LlmToolCall[] = []
    const result = await client.runConversation({
      model: 'test-model',
      system: 'you log meals',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 5,
      executeTool: (call) => {
        executed.push(call)
        return Promise.resolve({
          content: JSON.stringify({ candidates: [{ id: 1 }] }),
        })
      },
    })

    expect(result).toEqual({
      finalText: 'Logged ramen.',
      stopReason: 'end',
      turns: 2,
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'I ate ramen' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'call_1',
              name: 'search_food_master',
              input: { query: 'ramen' },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              toolUseId: 'call_1',
              content: JSON.stringify({ candidates: [{ id: 1 }] }),
            },
          ],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'Logged ramen.' }],
        },
      ],
    })
    expect(executed).toEqual([
      { id: 'call_1', name: 'search_food_master', input: { query: 'ramen' } },
    ])
    expect(mock.requests.length).toBe(2)
    expect(mock.requests[0]?.authorization).toBe('Bearer test-key')
    expect(mock.requests[1]?.body).toEqual({
      model: 'test-model',
      messages: [
        { role: 'system', content: 'you log meals' },
        { role: 'user', content: 'I ate ramen' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: {
                name: 'search_food_master',
                arguments: JSON.stringify({ query: 'ramen' }),
              },
            },
          ],
        },
        {
          role: 'tool',
          tool_call_id: 'call_1',
          content: JSON.stringify({ candidates: [{ id: 1 }] }),
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'search_food_master',
            description: 'search foods',
            parameters: {
              type: 'object',
              properties: { query: { type: 'string' } },
              required: ['query'],
            },
          },
        },
      ],
    })
  })

  it('stops safely with stopReason=max_turns when the model never finishes', async () => {
    const loopingResponse = {
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_loop',
                type: 'function',
                function: {
                  name: 'search_food_master',
                  arguments: JSON.stringify({ query: 'x' }),
                },
              },
            ],
          },
        },
      ],
    }
    mock = await startMockServer([
      loopingResponse,
      loopingResponse,
      loopingResponse,
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'test-key',
      baseUrl: mock.url,
    })
    let executedCount = 0
    const result = await client.runConversation({
      model: 'test-model',
      system: '',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 2,
      executeTool: () => {
        executedCount++
        return Promise.resolve({ content: '{}' })
      },
    })

    const actual = {
      stopReason: result.stopReason,
      turns: result.turns,
      finalText: result.finalText,
    }
    expect(actual).toEqual({
      stopReason: 'max_turns',
      turns: 2,
      finalText: '',
    })
    expect(mock.requests.length).toBe(2)
    expect(executedCount).toBe(1)
  })

  it('wraps executor errors as tool_result with isError=true', async () => {
    mock = await startMockServer([
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_err',
                  type: 'function',
                  function: {
                    name: 'search_food_master',
                    arguments: JSON.stringify({ query: 'x' }),
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'recovered' },
          },
        ],
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
    })
    const result = await client.runConversation({
      model: 'm',
      system: '',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 5,
      executeTool: () => Promise.reject(new Error('executor blew up')),
    })

    const actual = {
      stopReason: result.stopReason,
      finalText: result.finalText,
      lastUserMessage: result.messages[result.messages.length - 2],
    }
    expect(actual).toEqual({
      stopReason: 'end',
      finalText: 'recovered',
      lastUserMessage: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            toolUseId: 'call_err',
            content: 'executor blew up',
            isError: true,
          },
        ],
      },
    })
  })

  it('executes parallel tool_calls concurrently', async () => {
    mock = await startMockServer([
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'a',
                  type: 'function',
                  function: {
                    name: 'search_food_master',
                    arguments: JSON.stringify({ query: 'a' }),
                  },
                },
                {
                  id: 'b',
                  type: 'function',
                  function: {
                    name: 'search_food_master',
                    arguments: JSON.stringify({ query: 'b' }),
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'done' },
          },
        ],
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
    })
    const order: string[] = []
    let resolveA: (() => void) | undefined
    const aGate = new Promise<void>((r) => {
      resolveA = r
    })
    const result = await client.runConversation({
      model: 'm',
      system: '',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 5,
      executeTool: async (call) => {
        order.push(`start:${call.id}`)
        if (call.id === 'a') {
          await aGate
        } else if (call.id === 'b') {
          resolveA?.()
        }
        order.push(`end:${call.id}`)
        return { content: `ok:${call.id}` }
      },
    })

    expect(order).toEqual(['start:a', 'start:b', 'end:b', 'end:a'])
    expect(result.stopReason).toBe('end')
  })

  it('wraps malformed responses in OpenCodeLlmInvalidResponseError', async () => {
    mock = await startMockServer([{ choices: [{ finish_reason: 'stop' }] }])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
    })
    await expect(
      client.runConversation({
        model: 'm',
        system: '',
        messages: initialMessages,
        tools: [],
        maxTurns: 1,
        executeTool: () => Promise.resolve({ content: '' }),
      }),
    ).rejects.toThrow(OpenCodeLlmInvalidResponseError)
  })

  it('rejects responses with no choices', async () => {
    mock = await startMockServer([{ choices: [] }])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
    })
    await expect(
      client.runConversation({
        model: 'm',
        system: '',
        messages: initialMessages,
        tools: [],
        maxTurns: 1,
        executeTool: () => Promise.resolve({ content: '' }),
      }),
    ).rejects.toThrow(OpenCodeLlmInvalidResponseError)
  })

  it('parseToolInput treats null/undefined arguments as empty object', async () => {
    mock = await startMockServer([
      {
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_null',
                  type: 'function',
                  function: { name: 'search_food_master', arguments: null },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'ok' },
          },
        ],
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
    })
    const received: LlmToolCall[] = []
    const result = await client.runConversation({
      model: 'm',
      system: '',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 5,
      executeTool: (call) => {
        received.push(call)
        return Promise.resolve({ content: '{}' })
      },
    })

    expect(received).toEqual([
      { id: 'call_null', name: 'search_food_master', input: {} },
    ])
    expect(result.finalText).toBe('ok')
  })
})
