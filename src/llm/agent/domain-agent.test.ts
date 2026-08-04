import { createGenAiTracingMiddleware } from '@fohte/service-kit/langchain-genai'
import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'
import { context, SpanKind, trace } from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base'
import { fakeModel } from 'langchain'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { createMeshiDomainAgent } from '#llm/agent/domain-agent'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool } from '#llm/domain-tools/types'
import { ok } from '#llm/domain-tools/types'

const stubRegistry = (
  tools: ReadonlyArray<DomainTool>,
): DomainToolsRegistry => ({
  list: () => tools,
  get: (name) => tools.find((t) => t.name === name),
  toLlmSchemas: () =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  executeToolUse: () => {
    throw new Error('not used by createMeshiDomainAgent')
  },
})

const recordMealLogTool = (execute: DomainTool['execute']): DomainTool => ({
  name: 'record_meal_log',
  description: 'Records a meal log entry.',
  inputSchema: { type: 'object' },
  execute,
})

describe('createMeshiDomainAgent', () => {
  it('runs a domain tool call and returns the reply text as the final AI message', async () => {
    const registry = stubRegistry([
      recordMealLogTool(() =>
        Promise.resolve(ok({ meal_log_id: 'm1', is_estimated: false })),
      ),
    ])
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: { food_master_id: 'fm_1' },
          id: 'call_1',
        },
      ])
      .respond(new AIMessage('Recorded your meal.'))

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'I ate rice' }] },
      { configurable: { thread_id: 'thread-1' } },
    )

    expect(result.messages.at(-1)?.text).toBe('Recorded your meal.')
  })

  it('ends the turn right after calling request_user_input, without a further model turn', async () => {
    const registry = stubRegistry([])
    const model = fakeModel().respond(
      new AIMessage({
        content: 'Which food did you mean?',
        tool_calls: [
          {
            name: REQUEST_USER_INPUT_TOOL_NAME,
            args: { question: 'Which food did you mean?' },
            id: 'call_1',
            type: 'tool_call',
          },
        ],
      }),
    )

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'salmon' }] },
      { configurable: { thread_id: 'thread-2' } },
    )

    // Split across expect() calls rather than one combined literal: each
    // checks a genuinely distinct value (call count, message-type sequence,
    // reply text) rather than fragmenting a single structured output.
    expect(model.callCount).toBe(1)
    expect(result.messages.map((m) => m.type)).toEqual(['human', 'ai', 'tool'])
    expect(result.messages.find((m) => m.type === 'ai')?.text).toBe(
      'Which food did you mean?',
    )
  })
})

describe('createMeshiDomainAgent gen_ai tracing', () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider)
    context.setGlobalContextManager(new AsyncLocalStorageContextManager())
  })

  afterAll(async () => {
    context.disable()
    trace.disable()
    await provider.shutdown()
  })

  beforeEach(() => {
    exporter.reset()
  })

  it('forwards the middleware option to createAgent so both the chat and execute_tool hooks run', async () => {
    const registry = stubRegistry([
      recordMealLogTool(() =>
        Promise.resolve(ok({ meal_log_id: 'm1', is_estimated: false })),
      ),
    ])
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: { food_master_id: 'fm_1' },
          id: 'call_1',
        },
      ])
      .respond(new AIMessage('Recorded your meal.'))

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
      middleware: [
        createGenAiTracingMiddleware({ providerName: 'test-provider' }),
      ],
    })
    await agent.invoke(
      { messages: [{ role: 'user', content: 'I ate rice' }] },
      { configurable: { thread_id: 'thread-tracing-1' } },
    )

    expect(
      exporter.getFinishedSpans().map((span) => ({
        name: span.name,
        kind: span.kind,
      })),
    ).toEqual([
      { name: 'chat unknown', kind: SpanKind.CLIENT },
      { name: 'execute_tool record_meal_log', kind: SpanKind.INTERNAL },
      { name: 'chat unknown', kind: SpanKind.CLIENT },
    ])
  })
})
