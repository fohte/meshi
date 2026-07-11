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
import { type Span, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api'
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

const tracer = trace.getTracer('meshi-genai-callback-handler')

export interface GenAiCallbackHandlerOptions {
  readonly providerName: string
  readonly captureMessageContent?: boolean
}

// Shapes below follow the GenAI semantic conventions' message format
// (gen_ai.input.messages / gen_ai.output.messages), mirroring
// src/adapters/llm/openCodeLlmClient.ts:
// https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md

interface GenAiTextPart {
  readonly type: 'text'
  readonly content: string
}

interface GenAiToolCallPart {
  readonly type: 'tool_call'
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

interface GenAiToolCallResponsePart {
  readonly type: 'tool_call_response'
  readonly id: string
  readonly response: string
}

type GenAiMessagePart =
  GenAiTextPart | GenAiToolCallPart | GenAiToolCallResponsePart

interface GenAiMessage {
  readonly role: string
  readonly parts: ReadonlyArray<GenAiMessagePart>
}

interface GenAiOutputMessage extends GenAiMessage {
  readonly finish_reason?: string
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

const recordSpanException = (span: Span, error: unknown): void => {
  span.recordException(error instanceof Error ? error : String(error))
}

const setGenAiResponseAttributes = (
  span: Span,
  output: LLMResult,
  captureMessageContent: boolean,
): void => {
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

// Spans are opened in handleChatModelStart and closed in handleLLMEnd /
// handleLLMError, which are disjoint callback invocations for the same
// LangChain run — runId is the only thing correlating them, so the open
// span has to be tracked across the two calls.
export class GenAiCallbackHandler extends BaseCallbackHandler {
  name = 'GenAiCallbackHandler'

  private readonly providerName: string
  private readonly captureMessageContent: boolean
  private readonly openSpans = new Map<string, Span>()

  constructor(options: GenAiCallbackHandlerOptions) {
    super()
    this.providerName = options.providerName
    this.captureMessageContent = options.captureMessageContent ?? false
  }

  override handleChatModelStart(
    _llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    const model = resolveRequestModel(extraParams)
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
        span.setAttribute(
          ATTR_GEN_AI_INPUT_MESSAGES,
          JSON.stringify((messages[0] ?? []).map(messageToGenAiMessage)),
        )
      } catch (error) {
        recordSpanException(span, error)
      }
    }
    this.openSpans.set(runId, span)
  }

  override handleLLMEnd(output: LLMResult, runId: string): void {
    const span = this.openSpans.get(runId)
    if (span === undefined) return
    this.openSpans.delete(runId)
    try {
      setGenAiResponseAttributes(span, output, this.captureMessageContent)
    } catch (error) {
      recordSpanException(span, error)
    }
    span.end()
  }

  override handleLLMError(err: unknown, runId: string): void {
    const span = this.openSpans.get(runId)
    if (span === undefined) return
    this.openSpans.delete(runId)
    recordSpanException(span, err)
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    })
    span.end()
  }
}
