import type { Serialized } from '@langchain/core/load/serializable'
import {
  AIMessage,
  HumanMessage,
  type StandardMessageStructure,
  SystemMessage,
  ToolMessage,
} from '@langchain/core/messages'
import type { ChatGeneration, LLMResult } from '@langchain/core/outputs'
import {
  context,
  type Span,
  type SpanContext,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks'
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { GenAiCallbackHandler } from '@/adapters/llm/genAiCallbackHandler'

const serializedLlm: Serialized = {
  lc: 1,
  type: 'not_implemented',
  id: ['test-llm'],
}

const chatGeneration = (
  message: AIMessage<StandardMessageStructure>,
): ChatGeneration => ({
  text: message.text,
  message,
})

describe('GenAiCallbackHandler', () => {
  const exporter = new InMemorySpanExporter()
  const provider = new BasicTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })

  beforeAll(() => {
    trace.setGlobalTracerProvider(provider)
    // wrapFetch relies on a real context manager to make context.with()'s
    // span active during the wrapped fetch call, matching the
    // AsyncLocalStorage-backed manager NodeSDK registers in production.
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

  it('records gen_ai attributes and token usage on the inference span', () => {
    const handler = new GenAiCallbackHandler({
      providerName: 'opencode',
      captureMessageContent: false,
    })

    handler.handleChatModelStart(
      serializedLlm,
      [[new HumanMessage('I ate ramen')]],
      'run-1',
      undefined,
      { invocation_params: { model: 'test-model' } },
    )
    const responseMessage = new AIMessage<StandardMessageStructure>({
      content: 'Logged ramen.',
      response_metadata: {
        model_name: 'resolved-model',
        finish_reason: 'stop',
      },
      usage_metadata: { input_tokens: 42, output_tokens: 7, total_tokens: 49 },
    })
    const output: LLMResult = {
      generations: [[chatGeneration(responseMessage)]],
    }
    handler.handleLLMEnd(output, 'run-1')

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

  it('captures gen_ai.input.messages / gen_ai.output.messages and redacts images when captureMessageContent is enabled', () => {
    const handler = new GenAiCallbackHandler({
      providerName: 'opencode',
      captureMessageContent: true,
    })
    const toolResultContent = JSON.stringify({ candidates: [{ id: 1 }] })

    handler.handleChatModelStart(
      serializedLlm,
      [
        [
          new SystemMessage('you log meals'),
          new HumanMessage({
            content: [
              { type: 'text', text: 'What is in this photo?' },
              { type: 'image', mimeType: 'image/png', data: 'base64==' },
            ],
          }),
          new AIMessage<StandardMessageStructure>({
            content: '',
            tool_calls: [
              {
                id: 'call_1',
                name: 'search_food_master',
                args: { query: 'ramen' },
              },
            ],
          }),
          new ToolMessage({
            content: toolResultContent,
            tool_call_id: 'call_1',
          }),
        ],
      ],
      'run-2',
      undefined,
      { invocation_params: { model: 'test-model' } },
    )
    const responseMessage = new AIMessage<StandardMessageStructure>({
      content: 'Logged ramen.',
      response_metadata: { finish_reason: 'stop' },
    })
    handler.handleLLMEnd(
      { generations: [[chatGeneration(responseMessage)]] },
      'run-2',
    )

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
          {
            role: 'user',
            parts: [
              { type: 'text', content: 'What is in this photo?' },
              { type: 'text', content: '[image omitted]' },
            ],
          },
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

  it('records the error as a span exception and marks the span ERROR', () => {
    const handler = new GenAiCallbackHandler({ providerName: 'opencode' })

    handler.handleChatModelStart(
      serializedLlm,
      [[new HumanMessage('I ate ramen')]],
      'run-3',
      undefined,
      { invocation_params: { model: 'test-model' } },
    )
    handler.handleLLMError(new Error('rate limited'), 'run-3')

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
        status: { code: SpanStatusCode.ERROR, message: 'rate limited' },
        exceptionTypes: ['Error'],
      },
    ])
  })

  it('keeps the inference span active for a fetch issued while the span is open', async () => {
    const handler = new GenAiCallbackHandler({ providerName: 'opencode' })

    handler.handleChatModelStart(
      serializedLlm,
      [[new HumanMessage('I ate ramen')]],
      'run-4',
      undefined,
      { invocation_params: { model: 'test-model' } },
    )

    let capturedSpanContext: SpanContext | undefined
    const fakeFetch: typeof fetch = () => {
      capturedSpanContext = trace.getSpan(context.active())?.spanContext()
      return Promise.resolve(new Response(null))
    }
    await handler.wrapFetch(fakeFetch)('https://example.com')

    handler.handleLLMEnd(
      {
        generations: [
          [
            chatGeneration(
              new AIMessage<StandardMessageStructure>({
                content: 'Logged ramen.',
                response_metadata: {},
              }),
            ),
          ],
        ],
      },
      'run-4',
    )

    const [span] = exporter.getFinishedSpans()
    expect(capturedSpanContext).toEqual(span?.spanContext())
  })

  it('stops treating a span as active once it has ended', async () => {
    const handler = new GenAiCallbackHandler({ providerName: 'opencode' })

    handler.handleChatModelStart(
      serializedLlm,
      [[new HumanMessage('I ate ramen')]],
      'run-5',
      undefined,
      { invocation_params: { model: 'test-model' } },
    )
    handler.handleLLMEnd(
      {
        generations: [
          [
            chatGeneration(
              new AIMessage<StandardMessageStructure>({
                content: 'Logged ramen.',
                response_metadata: {},
              }),
            ),
          ],
        ],
      },
      'run-5',
    )

    let capturedSpan: Span | undefined
    const fakeFetch: typeof fetch = () => {
      capturedSpan = trace.getSpan(context.active())
      return Promise.resolve(new Response(null))
    }
    await handler.wrapFetch(fakeFetch)('https://example.com')

    expect(capturedSpan).toBeUndefined()
  })

  it('ignores handleLLMEnd / handleLLMError for a runId with no open span', () => {
    const handler = new GenAiCallbackHandler({ providerName: 'opencode' })

    handler.handleLLMEnd(
      {
        generations: [
          [
            chatGeneration(
              new AIMessage<StandardMessageStructure>('unexpected'),
            ),
          ],
        ],
      },
      'unknown-run',
    )
    handler.handleLLMError(new Error('unexpected'), 'unknown-run')

    expect(exporter.getFinishedSpans()).toEqual([])
  })
})
