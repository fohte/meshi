import { AsyncLocalStorage } from 'node:async_hooks'

import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import {
  AIMessage,
  type BaseMessage,
  type StandardMessageStructure,
  ToolMessage,
} from '@langchain/core/messages'
import type {
  ChatGeneration,
  Generation,
  LLMResult,
} from '@langchain/core/outputs'
import {
  type Context,
  context,
  type Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api'
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
  GEN_AI_OPERATION_NAME_VALUE_CHAT,
} from '@opentelemetry/semantic-conventions/incubating'

import {
  type GenAiMessage,
  type GenAiMessagePart,
  type GenAiOutputMessage,
  recordSpanException,
} from '@/adapters/llm/genAiSemconv'

const tracer = trace.getTracer('meshi-genai-callback-handler')

export interface GenAiCallbackHandlerOptions {
  readonly providerName: string
  readonly captureMessageContent?: boolean
}

const roleForMessage = (message: BaseMessage): string => {
  switch (message.type) {
    case 'human':
      return 'user'
    case 'ai':
      return 'assistant'
    case 'system':
      return 'system'
    case 'tool':
      return 'tool'
    default:
      return message.type
  }
}

// Raw image bytes are redacted: they bloat span payloads and, unlike text,
// carry no debugging value once reduced to an opaque data URL.
const messageToGenAiParts = (message: BaseMessage): GenAiMessagePart[] => {
  if (ToolMessage.isInstance(message)) {
    return [
      {
        type: 'tool_call_response',
        id: message.tool_call_id,
        response: message.text,
      },
    ]
  }
  if (AIMessage.isInstance(message)) {
    const parts: GenAiMessagePart[] = []
    if (message.text !== '') {
      parts.push({ type: 'text', content: message.text })
    }
    for (const call of message.tool_calls ?? []) {
      parts.push({
        type: 'tool_call',
        id: call.id ?? '',
        name: call.name,
        arguments: call.args,
      })
    }
    return parts
  }
  return message.contentBlocks.flatMap((block): GenAiMessagePart[] => {
    if (block.type === 'text') return [{ type: 'text', content: block.text }]
    if (block.type === 'image') {
      return [{ type: 'text', content: '[image omitted]' }]
    }
    return []
  })
}

const messageToGenAiMessage = (message: BaseMessage): GenAiMessage => ({
  role: roleForMessage(message),
  parts: messageToGenAiParts(message),
})

const resolveFinishReason = (message: BaseMessage): string | undefined => {
  const value = message.response_metadata['finish_reason']
  return typeof value === 'string' ? value : undefined
}

const resolveResponseModel = (message: BaseMessage): string | undefined => {
  const metadata = message.response_metadata
  const value = metadata['model_name'] ?? metadata['model']
  return typeof value === 'string' ? value : undefined
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// LangChain chat model integrations don't agree on a single invocationParams
// key for the model identifier: most use `model`, some use `model_name`.
const resolveRequestModel = (
  extraParams: Record<string, unknown> | undefined,
): string => {
  const invocationParams = extraParams?.['invocation_params']
  if (isRecord(invocationParams)) {
    const model = invocationParams['model'] ?? invocationParams['model_name']
    if (typeof model === 'string') return model
  }
  return 'unknown'
}

const isChatGeneration = (
  generation: Generation,
): generation is ChatGeneration => 'message' in generation

// AIMessage.isInstance()'s own generic overload infers TStructure from the
// unparameterized BaseMessage type, which resolves usage_metadata to `never`
// rather than UsageMetadata. Runtime instances are always constructed with
// the standard structure, so narrowing explicitly to it here is safe.
const isAiMessageWithStandardStructure = (
  message: BaseMessage,
): message is AIMessage<StandardMessageStructure> =>
  AIMessage.isInstance(message)

const chatGenerationToGenAiOutputMessage = (
  generation: ChatGeneration,
): GenAiOutputMessage => {
  const finishReason = resolveFinishReason(generation.message)
  return {
    ...messageToGenAiMessage(generation.message),
    ...(finishReason !== undefined ? { finish_reason: finishReason } : {}),
  }
}

const setGenAiResponseAttributes = (
  span: Span,
  output: LLMResult,
  captureMessageContent: boolean,
): void => {
  // output.generations is one entry per prompt in a batched call, but
  // @langchain/core's CallbackManager always invokes handleLLMEnd once per
  // prompt with its own runId (see handleChatModelStart below), so this
  // handler only ever sees a single-entry outer array here.
  const chatGenerations = (output.generations[0] ?? []).filter(isChatGeneration)

  const firstMessage = chatGenerations[0]?.message
  if (firstMessage !== undefined) {
    const responseModel = resolveResponseModel(firstMessage)
    if (responseModel !== undefined) {
      span.setAttribute(ATTR_GEN_AI_RESPONSE_MODEL, responseModel)
    }
    if (
      isAiMessageWithStandardStructure(firstMessage) &&
      firstMessage.usage_metadata !== undefined
    ) {
      span.setAttribute(
        ATTR_GEN_AI_USAGE_INPUT_TOKENS,
        firstMessage.usage_metadata.input_tokens,
      )
      span.setAttribute(
        ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
        firstMessage.usage_metadata.output_tokens,
      )
    }
  }

  const finishReasons = chatGenerations
    .map((generation) => resolveFinishReason(generation.message))
    .filter((reason): reason is string => reason !== undefined)
  if (finishReasons.length > 0) {
    span.setAttribute(ATTR_GEN_AI_RESPONSE_FINISH_REASONS, finishReasons)
  }

  if (captureMessageContent) {
    span.setAttribute(
      ATTR_GEN_AI_OUTPUT_MESSAGES,
      JSON.stringify(chatGenerations.map(chatGenerationToGenAiOutputMessage)),
    )
  }
}

interface OpenSpan {
  readonly span: Span
  // Context active immediately before this span was opened, restored via
  // activeContext.enterWith() once the span ends so a later, unrelated fetch
  // on the same call chain doesn't keep tracing through this closed span.
  readonly previousContext: Context
}

// Spans are opened in handleChatModelStart and closed in handleLLMEnd /
// handleLLMError, which are disjoint callback invocations for the same
// LangChain run — runId is the only thing correlating them, so the open
// span has to be tracked across the two calls.
export class GenAiCallbackHandler extends BaseCallbackHandler {
  name = 'GenAiCallbackHandler'

  private readonly providerName: string
  private readonly captureMessageContent: boolean
  private readonly openSpans = new Map<string, OpenSpan>()
  // handleChatModelStart/handleLLMEnd/handleLLMError never share a
  // synchronous call frame with the actual model request, so a
  // context.with() around either callback reverts before that request's
  // fetch runs — Node only extends AsyncLocalStorage's active store to
  // async work started underneath a context.with() callback, not to a
  // sibling callback invoked later by the CallbackManager. enterWith()
  // instead mutates the store in place, which does persist across that
  // gap, letting wrapFetch's context.with() below pick it up.
  private readonly activeContext = new AsyncLocalStorage<Context>()

  constructor(options: GenAiCallbackHandlerOptions) {
    // Without _awaitHandler, @langchain/core's CallbackManager delivers this
    // handler's callbacks through a process-wide, concurrency-1 background
    // queue (see consumeCallback in @langchain/core/dist/singletons/callbacks.js)
    // instead of the caller's own call chain. Since activeContext threads its
    // context through that chain via AsyncLocalStorage, running on the shared
    // queue would let unrelated concurrent requests stomp on each other's
    // active span.
    super({ _awaitHandler: true })
    this.providerName = options.providerName
    this.captureMessageContent = options.captureMessageContent ?? false
  }

  // Wraps a fetch implementation so a request issued while a `chat <model>`
  // span is open runs with that span active, letting
  // @opentelemetry/instrumentation-undici parent its own request span to it.
  wrapFetch(fetchImpl: typeof fetch): typeof fetch {
    return (input, init) => {
      const ctx = this.activeContext.getStore()
      return ctx === undefined
        ? fetchImpl(input, init)
        : context.with(ctx, () => fetchImpl(input, init))
    }
  }

  private takeOpenSpan(runId: string): OpenSpan | undefined {
    const openSpan = this.openSpans.get(runId)
    if (openSpan === undefined) return undefined
    this.openSpans.delete(runId)
    return openSpan
  }

  // Assumes at most one span is open per call chain at a time — true for
  // createMeshiChatModel's usage, since LangGraph's createAgent invokes the
  // model sequentially. Two spans opened concurrently on the same chain
  // would both enterWith() onto this single activeContext slot, and closing
  // either one first would wrongly restore the other's still-open span to
  // the outer context.
  private finishSpan(openSpan: OpenSpan): void {
    openSpan.span.end()
    this.activeContext.enterWith(openSpan.previousContext)
  }

  override handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    const model = resolveRequestModel(extraParams)
    const previousContext = context.active()
    const span = tracer.startSpan(
      `${GEN_AI_OPERATION_NAME_VALUE_CHAT} ${model}`,
      { kind: SpanKind.CLIENT },
    )
    span.setAttributes({
      [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_CHAT,
      [ATTR_GEN_AI_PROVIDER_NAME]: this.providerName,
      [ATTR_GEN_AI_REQUEST_MODEL]: model,
    })
    if (this.captureMessageContent) {
      try {
        // messages is one entry per prompt in a batched call, but
        // CallbackManager.handleChatModelStart splits a batch into one call
        // per prompt (each with a distinct runId) before invoking handlers,
        // so this handler only ever sees a single-entry outer array here.
        span.setAttribute(
          ATTR_GEN_AI_INPUT_MESSAGES,
          JSON.stringify((messages[0] ?? []).map(messageToGenAiMessage)),
        )
      } catch (error) {
        recordSpanException(span, error)
      }
    }
    this.openSpans.set(runId, { span, previousContext })
    this.activeContext.enterWith(trace.setSpan(previousContext, span))
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const openSpan = this.takeOpenSpan(runId)
    if (openSpan === undefined) return
    try {
      setGenAiResponseAttributes(
        openSpan.span,
        output,
        this.captureMessageContent,
      )
    } catch (error) {
      recordSpanException(openSpan.span, error)
    }
    this.finishSpan(openSpan)
  }

  override handleLLMError(err: unknown, runId: string): void {
    const openSpan = this.takeOpenSpan(runId)
    if (openSpan === undefined) return
    recordSpanException(openSpan.span, err)
    openSpan.span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    })
    this.finishSpan(openSpan)
  }
}
