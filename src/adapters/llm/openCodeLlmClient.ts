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
import { z } from 'zod'

import {
  type GenAiMessage,
  type GenAiMessagePart,
  type GenAiOutputMessage,
  type GenAiToolCallPart,
  recordSpanException,
} from '@/adapters/llm/genAiSemconv'
import type {
  LlmClient,
  LlmContent,
  LlmMessage,
  LlmRunInput,
  LlmRunOutput,
  LlmStopReason,
  LlmToolCall,
  LlmToolSchema,
} from '@/adapters/llm/types'

export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

// Identifies this HTTP client's telemetry format flavor to consumers of the
// span (OpenCode Go proxies to multiple underlying model providers, so this
// is the gateway being called, not the resolved model's own provider).
const GEN_AI_PROVIDER_NAME_VALUE_OPENCODE = 'opencode'

const tracer = trace.getTracer('meshi-opencode-llm-client')

export interface OpenCodeLlmClientOptions {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
  readonly captureMessageContent?: boolean
}

interface OpenAiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | ReadonlyArray<OpenAiContentPart> | null
  tool_calls?: ReadonlyArray<OpenAiToolCall>
  tool_call_id?: string
}

interface OpenAiTextPart {
  type: 'text'
  text: string
}

interface OpenAiImageUrlPart {
  type: 'image_url'
  image_url: { url: string }
}

type OpenAiContentPart = OpenAiTextPart | OpenAiImageUrlPart

interface OpenAiToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

interface OpenAiTool {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Readonly<Record<string, unknown>>
  }
}

interface OpenAiChatRequest {
  model: string
  messages: ReadonlyArray<OpenAiChatMessage>
  tools?: ReadonlyArray<OpenAiTool>
}

const openAiToolCallSchema = z.object({
  id: z.string(),
  type: z.literal('function'),
  function: z.object({
    name: z.string(),
    arguments: z.string().nullish(),
  }),
})

const openAiChatResponseSchema = z.object({
  model: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().optional(),
        message: z.object({
          role: z.string().optional(),
          content: z.string().nullish(),
          tool_calls: z.array(openAiToolCallSchema).optional(),
        }),
      }),
    )
    .nonempty('OpenCode Go returned a response with no choices'),
  // Fields are individually optional, not just the object itself: OpenCode Go
  // proxies to multiple underlying providers, and a provider quirk in this
  // telemetry-only field shouldn't fail parsing of the response the
  // conversation actually depends on (choices/tool_calls).
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
    })
    .optional(),
})

type OpenAiChatResponse = z.infer<typeof openAiChatResponseSchema>

export class OpenCodeLlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenCode Go HTTP ${String(status)}: ${body}`)
    this.name = 'OpenCodeLlmHttpError'
  }
}

export class OpenCodeLlmInvalidResponseError extends Error {
  constructor(
    public readonly issues: z.ZodError,
    public readonly raw: unknown,
  ) {
    super(`OpenCode Go returned an invalid response: ${issues.message}`)
    this.name = 'OpenCodeLlmInvalidResponseError'
    this.cause = issues
  }
}

const toolToOpenAi = (tool: LlmToolSchema): OpenAiTool => ({
  type: 'function',
  function: {
    name: tool.name,
    description: tool.description,
    parameters: tool.inputSchema,
  },
})

const contentToOpenAiUserParts = (
  content: ReadonlyArray<LlmContent>,
): string | ReadonlyArray<OpenAiContentPart> => {
  const parts: OpenAiContentPart[] = []
  for (const block of content) {
    if (block.type === 'text') {
      parts.push({ type: 'text', text: block.text })
    } else if (block.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${block.mimeType};base64,${block.base64}` },
      })
    }
  }
  if (parts.length === 1 && parts[0]?.type === 'text') {
    return parts[0].text
  }
  return parts
}

const messagesToOpenAi = (
  system: string,
  messages: ReadonlyArray<LlmMessage>,
): OpenAiChatMessage[] => {
  const out: OpenAiChatMessage[] = []
  if (system !== '') {
    out.push({ role: 'system', content: system })
  }
  for (const message of messages) {
    if (message.role === 'assistant') {
      const text = extractText(message.content)
      const toolCalls: OpenAiToolCall[] = message.content
        .filter(isToolUseContent)
        .map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.input ?? {}) },
        }))
      const assistantMessage: OpenAiChatMessage = {
        role: 'assistant',
        content: text === '' ? null : text,
      }
      if (toolCalls.length > 0) {
        assistantMessage.tool_calls = toolCalls
      }
      out.push(assistantMessage)
      continue
    }
    const toolResults = message.content.filter(isToolResultContent)
    for (const r of toolResults) {
      out.push({
        role: 'tool',
        tool_call_id: r.toolUseId,
        content: r.content,
      })
    }
    const userParts = message.content.filter(
      (c) => c.type === 'text' || c.type === 'image',
    )
    if (userParts.length > 0) {
      out.push({
        role: 'user',
        content: contentToOpenAiUserParts(userParts),
      })
    }
  }
  return out
}

const parseToolInput = (raw: string | null | undefined): unknown => {
  if (raw === undefined || raw === null || raw === '') return {}
  try {
    return JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `OpenCode Go returned tool arguments that are not valid JSON: ${raw}`,
      { cause },
    )
  }
}

const isTextContent = (
  c: LlmContent,
): c is Extract<LlmContent, { type: 'text' }> => c.type === 'text'

const isToolUseContent = (
  c: LlmContent,
): c is Extract<LlmContent, { type: 'tool_use' }> => c.type === 'tool_use'

const isToolResultContent = (
  c: LlmContent,
): c is Extract<LlmContent, { type: 'tool_result' }> => c.type === 'tool_result'

const extractText = (content: ReadonlyArray<LlmContent>): string =>
  content
    .filter(isTextContent)
    .map((c) => c.text)
    .join('')

const responseToAssistantMessage = (
  res: OpenAiChatResponse,
): { message: LlmMessage; toolCalls: LlmToolCall[] } => {
  // Schema's .nonempty() enforces this at runtime, but z.infer widens
  // choices to T[] rather than [T, ...T[]], so the narrowing here is
  // a type-system necessity, not a runtime check.
  const [first] = res.choices
  if (first === undefined) {
    throw new Error('unreachable: schema guarantees at least one choice')
  }
  const { message } = first
  const content: LlmContent[] = []
  if (
    message.content !== undefined &&
    message.content !== null &&
    message.content !== ''
  ) {
    content.push({ type: 'text', text: message.content })
  }
  const toolCalls: LlmToolCall[] = []
  for (const call of message.tool_calls ?? []) {
    const input = parseToolInput(call.function.arguments)
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input,
    })
    toolCalls.push({ id: call.id, name: call.function.name, input })
  }
  return { message: { role: 'assistant', content }, toolCalls }
}

const openAiContentToGenAiParts = (
  content: OpenAiChatMessage['content'],
): GenAiMessagePart[] => {
  if (content === null || content === '') return []
  if (typeof content === 'string') {
    return [{ type: 'text', content }]
  }
  // Raw image bytes are redacted: they bloat span payloads and, unlike text,
  // carry no debugging value once reduced to an opaque data URL.
  return content.map((part): GenAiMessagePart =>
    part.type === 'text'
      ? { type: 'text', content: part.text }
      : { type: 'text', content: '[image omitted]' },
  )
}

// Structural type covering both the request-side OpenAiToolCall (arguments:
// string) and the response schema's zod-inferred tool call (arguments:
// string | null | undefined), so this one helper serves both directions.
interface GenAiSourceToolCall {
  readonly id: string
  readonly function: {
    readonly name: string
    readonly arguments?: string | null | undefined
  }
}

const toolCallsToGenAiParts = (
  toolCalls: ReadonlyArray<GenAiSourceToolCall> | undefined,
): GenAiToolCallPart[] =>
  (toolCalls ?? []).map((call) => ({
    type: 'tool_call',
    id: call.id,
    name: call.function.name,
    arguments: parseToolInput(call.function.arguments),
  }))

const openAiMessageToGenAiMessage = (
  message: OpenAiChatMessage,
): GenAiMessage => {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      parts: [
        {
          type: 'tool_call_response',
          id: message.tool_call_id ?? '',
          response: typeof message.content === 'string' ? message.content : '',
        },
      ],
    }
  }
  return {
    role: message.role,
    parts: [
      ...openAiContentToGenAiParts(message.content),
      ...toolCallsToGenAiParts(message.tool_calls),
    ],
  }
}

const choiceToGenAiOutputMessage = (
  choice: OpenAiChatResponse['choices'][number],
): GenAiOutputMessage => {
  const { message } = choice
  const textParts: GenAiMessagePart[] =
    message.content !== undefined &&
    message.content !== null &&
    message.content !== ''
      ? [{ type: 'text', content: message.content }]
      : []
  return {
    role: message.role ?? 'assistant',
    parts: [...textParts, ...toolCallsToGenAiParts(message.tool_calls)],
    ...(choice.finish_reason !== undefined
      ? { finish_reason: choice.finish_reason }
      : {}),
  }
}

const setGenAiResponseAttributes = (
  span: Span,
  json: OpenAiChatResponse,
  captureMessageContent: boolean,
): void => {
  if (json.model !== undefined) {
    span.setAttribute(ATTR_GEN_AI_RESPONSE_MODEL, json.model)
  }
  if (json.usage?.prompt_tokens !== undefined) {
    span.setAttribute(ATTR_GEN_AI_USAGE_INPUT_TOKENS, json.usage.prompt_tokens)
  }
  if (json.usage?.completion_tokens !== undefined) {
    span.setAttribute(
      ATTR_GEN_AI_USAGE_OUTPUT_TOKENS,
      json.usage.completion_tokens,
    )
  }
  const finishReasons = json.choices
    .map((c) => c.finish_reason)
    .filter((r): r is string => r !== undefined)
  if (finishReasons.length > 0) {
    span.setAttribute(ATTR_GEN_AI_RESPONSE_FINISH_REASONS, finishReasons)
  }
  if (captureMessageContent) {
    span.setAttribute(
      ATTR_GEN_AI_OUTPUT_MESSAGES,
      JSON.stringify(json.choices.map(choiceToGenAiOutputMessage)),
    )
  }
}

export class OpenCodeLlmClient implements LlmClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch
  private readonly captureMessageContent: boolean

  constructor(options: OpenCodeLlmClientOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl ?? OPENCODE_GO_BASE_URL
    this.fetchImpl = options.fetch ?? fetch
    this.captureMessageContent = options.captureMessageContent ?? false
  }

  // One span per model inference call, matching the GenAI semantic
  // conventions' `{gen_ai.operation.name} {gen_ai.request.model}` span.
  private async callChatCompletions(
    body: OpenAiChatRequest,
  ): Promise<OpenAiChatResponse> {
    return tracer.startActiveSpan(
      `${GEN_AI_OPERATION_NAME_VALUE_CHAT} ${body.model}`,
      { kind: SpanKind.CLIENT },
      async (span) => {
        try {
          span.setAttributes({
            [ATTR_GEN_AI_OPERATION_NAME]: GEN_AI_OPERATION_NAME_VALUE_CHAT,
            [ATTR_GEN_AI_PROVIDER_NAME]: GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
            [ATTR_GEN_AI_REQUEST_MODEL]: body.model,
          })
          if (this.captureMessageContent) {
            try {
              span.setAttribute(
                ATTR_GEN_AI_INPUT_MESSAGES,
                JSON.stringify(body.messages.map(openAiMessageToGenAiMessage)),
              )
            } catch (error) {
              recordSpanException(span, error)
            }
          }

          const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${this.apiKey}`,
            },
            body: JSON.stringify(body),
          })
          if (!res.ok) {
            throw new OpenCodeLlmHttpError(res.status, await res.text())
          }
          const raw: unknown = await res.json()
          const parsed = openAiChatResponseSchema.safeParse(raw)
          if (!parsed.success) {
            throw new OpenCodeLlmInvalidResponseError(parsed.error, raw)
          }
          const json = parsed.data
          try {
            setGenAiResponseAttributes(span, json, this.captureMessageContent)
          } catch (error) {
            recordSpanException(span, error)
          }
          return json
        } catch (error) {
          recordSpanException(span, error)
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: error instanceof Error ? error.message : String(error),
          })
          throw error
        } finally {
          span.end()
        }
      },
    )
  }

  async runConversation(input: LlmRunInput): Promise<LlmRunOutput> {
    if (input.maxTurns <= 0) {
      throw new Error('maxTurns must be a positive integer')
    }
    const tools = input.tools.map(toolToOpenAi)
    let messages: LlmMessage[] = [...input.messages]
    let turns = 0
    let stopReason: LlmStopReason = 'max_turns'
    let finalText = ''

    while (turns < input.maxTurns) {
      turns++
      const body: OpenAiChatRequest = {
        model: input.model,
        messages: messagesToOpenAi(input.system, messages),
        ...(tools.length > 0 ? { tools } : {}),
      }
      const json = await this.callChatCompletions(body)
      const { message: assistantMessage, toolCalls } =
        responseToAssistantMessage(json)
      messages = [...messages, assistantMessage]

      if (toolCalls.length === 0) {
        stopReason = 'end'
        finalText = extractText(assistantMessage.content)
        break
      }

      // Skip tool execution on the final allowed turn: results would not be
      // fed back to the model, so running the tools would only leave orphan
      // side effects (e.g. DB writes from record_meal_log).
      if (turns >= input.maxTurns) {
        break
      }

      const toolResults: LlmContent[] = await Promise.all(
        toolCalls.map(async (call): Promise<LlmContent> => {
          try {
            const result = await input.executeTool(call)
            return {
              type: 'tool_result',
              toolUseId: call.id,
              content: result.content,
              ...(result.isError === true ? { isError: true } : {}),
            }
          } catch (error) {
            return {
              type: 'tool_result',
              toolUseId: call.id,
              content: error instanceof Error ? error.message : String(error),
              isError: true,
            }
          }
        }),
      )
      messages = [...messages, { role: 'user', content: toolResults }]
    }

    return { finalText, messages, stopReason, turns }
  }
}
