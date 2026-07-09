import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { ATTR_EXCEPTION_TYPE } from '@opentelemetry/semantic-conventions'
import {
  ATTR_GEN_AI_INPUT_MESSAGES,
  ATTR_GEN_AI_OPERATION_NAME,
  ATTR_GEN_AI_OUTPUT_MESSAGES,
  ATTR_GEN_AI_PROVIDER_NAME,
  ATTR_GEN_AI_REQUEST_MODEL,
  ATTR_GEN_AI_RESPONSE_FINISH_REASONS,
  ATTR_GEN_AI_RESPONSE_MODEL,
  ATTR_GEN_AI_USAGE_INPUT_TOKENS,
  ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
} from '@opentelemetry/semantic-conventions/incubating'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest'

import {
  OpenCodeLlmClient,
  OpenCodeLlmHttpError,
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

const MOCK_ERROR_RESPONSE = Symbol('mockErrorResponse')

interface MockErrorResponse {
  readonly [MOCK_ERROR_RESPONSE]: true
  readonly status: number
  readonly body: string
}

// A symbol key can never appear on a plain JSON fixture object, so this is
// unambiguous against the success-response entries below.
const mockErrorResponse = (
  status: number,
  body: string,
): MockErrorResponse => ({
  [MOCK_ERROR_RESPONSE]: true,
  status,
  body,
})

const isMockErrorResponse = (
  response: Record<string, unknown> | MockErrorResponse,
): response is MockErrorResponse =>
  (response as Partial<MockErrorResponse>)[MOCK_ERROR_RESPONSE] === true

const startMockServer = async (
  responses: ReadonlyArray<Record<string, unknown> | MockErrorResponse>,
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
      if (response !== undefined && isMockErrorResponse(response)) {
        res.writeHead(response.status, { 'content-type': 'text/plain' })
        res.end(response.body)
        return
      }
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

    expect({
      result,
      executed,
      requestCount: mock.requests.length,
      firstAuth: mock.requests[0]?.authorization,
      secondRequestBody: mock.requests[1]?.body,
    }).toEqual({
      result: {
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
      },
      executed: [
        { id: 'call_1', name: 'search_food_master', input: { query: 'ramen' } },
      ],
      requestCount: 2,
      firstAuth: 'Bearer test-key',
      secondRequestBody: {
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
      },
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

    expect({
      stopReason: result.stopReason,
      turns: result.turns,
      finalText: result.finalText,
      requestCount: mock.requests.length,
      executedCount,
    }).toEqual({
      stopReason: 'max_turns',
      turns: 2,
      finalText: '',
      requestCount: 2,
      executedCount: 1,
    })
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

    expect({
      stopReason: result.stopReason,
      finalText: result.finalText,
      lastUserMessage: result.messages[result.messages.length - 2],
    }).toEqual({
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

    expect({ order, stopReason: result.stopReason }).toEqual({
      order: ['start:a', 'start:b', 'end:b', 'end:a'],
      stopReason: 'end',
    })
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

    expect({ received, finalText: result.finalText }).toEqual({
      received: [{ id: 'call_null', name: 'search_food_master', input: {} }],
      finalText: 'ok',
    })
  })
})

describe('OpenCodeLlmClient tracing', () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider)
  })

  afterAll(async () => {
    trace.disable()
    await provider.shutdown()
  })

  beforeEach(() => {
    exporter.reset()
  })

  let mock: MockServer | undefined

  afterEach(async () => {
    if (mock !== undefined) {
      const m = mock
      mock = undefined
      await m.close()
    }
  })

  it('records gen_ai attributes and token usage on the inference span', async () => {
    mock = await startMockServer([
      {
        model: 'resolved-model',
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Logged ramen.' },
          },
        ],
        usage: { prompt_tokens: 42, completion_tokens: 7 },
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'test-key',
      baseUrl: mock.url,
      captureMessageContent: false,
    })
    await client.runConversation({
      model: 'test-model',
      system: '',
      messages: initialMessages,
      tools: [],
      maxTurns: 1,
      executeTool: () => Promise.resolve({ content: '' }),
    })

    const spans = exporter.getFinishedSpans()
    expect(
      spans.map((span) => ({
        name: span.name,
        kind: span.kind,
        status: span.status,
        attributes: span.attributes,
      })),
    ).toEqual([
      {
        name: 'chat test-model',
        kind: SpanKind.CLIENT,
        status: { code: SpanStatusCode.UNSET },
        attributes: {
          [ATTR_GEN_AI_OPERATION_NAME]: 'chat',
          [ATTR_GEN_AI_PROVIDER_NAME]: 'opencode',
          [ATTR_GEN_AI_REQUEST_MODEL]: 'test-model',
          [ATTR_GEN_AI_RESPONSE_MODEL]: 'resolved-model',
          [ATTR_GEN_AI_USAGE_INPUT_TOKENS]: 42,
          [ATTR_GEN_AI_USAGE_OUTPUT_TOKENS]: 7,
          [ATTR_GEN_AI_RESPONSE_FINISH_REASONS]: ['stop'],
        },
      },
    ])
  })

  it('captures gen_ai.input.messages / gen_ai.output.messages per turn when captureMessageContent is enabled', async () => {
    const toolResultContent = JSON.stringify({ candidates: [{ id: 1 }] })
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
      captureMessageContent: true,
    })
    await client.runConversation({
      model: 'test-model',
      system: 'you log meals',
      messages: initialMessages,
      tools: [tool],
      maxTurns: 5,
      executeTool: () => Promise.resolve({ content: toolResultContent }),
    })

    const spans = exporter.getFinishedSpans()
    expect(
      spans.map((span) => ({
        inputMessages: JSON.parse(
          String(span.attributes[ATTR_GEN_AI_INPUT_MESSAGES]),
        ) as unknown,
        outputMessages: JSON.parse(
          String(span.attributes[ATTR_GEN_AI_OUTPUT_MESSAGES]),
        ) as unknown,
      })),
    ).toEqual([
      {
        inputMessages: [
          {
            role: 'system',
            parts: [{ type: 'text', content: 'you log meals' }],
          },
          { role: 'user', parts: [{ type: 'text', content: 'I ate ramen' }] },
        ],
        outputMessages: [
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                id: 'call_1',
                name: 'search_food_master',
                arguments: { query: 'ramen' },
              },
            ],
            finish_reason: 'tool_calls',
          },
        ],
      },
      {
        inputMessages: [
          {
            role: 'system',
            parts: [{ type: 'text', content: 'you log meals' }],
          },
          { role: 'user', parts: [{ type: 'text', content: 'I ate ramen' }] },
          {
            role: 'assistant',
            parts: [
              {
                type: 'tool_call',
                id: 'call_1',
                name: 'search_food_master',
                arguments: { query: 'ramen' },
              },
            ],
          },
          {
            role: 'tool',
            parts: [
              {
                type: 'tool_call_response',
                id: 'call_1',
                response: toolResultContent,
              },
            ],
          },
        ],
        outputMessages: [
          {
            role: 'assistant',
            parts: [{ type: 'text', content: 'Logged ramen.' }],
            finish_reason: 'stop',
          },
        ],
      },
    ])
  })

  it('records the HTTP error as a span exception and marks the span ERROR', async () => {
    mock = await startMockServer([mockErrorResponse(500, 'boom')])

    const client = new OpenCodeLlmClient({
      apiKey: 'k',
      baseUrl: mock.url,
      captureMessageContent: false,
    })

    await expect(
      client.runConversation({
        model: 'test-model',
        system: '',
        messages: initialMessages,
        tools: [],
        maxTurns: 1,
        executeTool: () => Promise.resolve({ content: '' }),
      }),
    ).rejects.toThrow(OpenCodeLlmHttpError)

    const spans = exporter.getFinishedSpans()
    expect(
      spans.map((span) => ({
        name: span.name,
        status: span.status,
        exceptionTypes: span.events
          .filter((e) => e.name === 'exception')
          .map((e) => e.attributes?.[ATTR_EXCEPTION_TYPE]),
      })),
    ).toEqual([
      {
        name: 'chat test-model',
        status: {
          code: SpanStatusCode.ERROR,
          message: 'OpenCode Go HTTP 500: boom',
        },
        exceptionTypes: ['OpenCodeLlmHttpError'],
      },
    ])
  })

  it('records a span exception without failing the call when a non-primary choice has malformed tool call arguments', async () => {
    // responseToAssistantMessage only reads choices[0] (fine here), but
    // setGenAiResponseAttributes walks every choice for gen_ai.output.messages
    // — this exercises the resulting throw from the malformed second choice.
    mock = await startMockServer([
      {
        choices: [
          {
            finish_reason: 'stop',
            message: { role: 'assistant', content: 'Logged ramen.' },
          },
          {
            finish_reason: 'stop',
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_bad',
                  type: 'function',
                  function: {
                    name: 'search_food_master',
                    arguments: 'not valid json',
                  },
                },
              ],
            },
          },
        ],
      },
    ])

    const client = new OpenCodeLlmClient({
      apiKey: 'test-key',
      baseUrl: mock.url,
      captureMessageContent: true,
    })
    const result = await client.runConversation({
      model: 'test-model',
      system: '',
      messages: initialMessages,
      tools: [],
      maxTurns: 1,
      executeTool: () => Promise.resolve({ content: '' }),
    })

    const spans = exporter.getFinishedSpans()
    expect({
      finalText: result.finalText,
      spans: spans.map((span) => ({
        status: span.status,
        exceptionTypes: span.events
          .filter((e) => e.name === 'exception')
          .map((e) => e.attributes?.[ATTR_EXCEPTION_TYPE]),
        hasFinishReasons:
          span.attributes[ATTR_GEN_AI_RESPONSE_FINISH_REASONS] !== undefined,
        hasOutputMessages:
          span.attributes[ATTR_GEN_AI_OUTPUT_MESSAGES] !== undefined,
      })),
    }).toEqual({
      finalText: 'Logged ramen.',
      spans: [
        {
          status: { code: SpanStatusCode.UNSET },
          exceptionTypes: ['Error'],
          hasFinishReasons: true,
          hasOutputMessages: false,
        },
      ],
    })
  })
})
