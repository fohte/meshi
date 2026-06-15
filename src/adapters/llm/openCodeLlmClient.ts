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

export interface OpenCodeLlmClientOptions {
  readonly apiKey: string
  readonly baseUrl?: string
  readonly fetch?: typeof fetch
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

interface OpenAiChatResponse {
  choices?: ReadonlyArray<{
    finish_reason?: string
    message?: {
      role?: string
      content?: string | null
      tool_calls?: ReadonlyArray<OpenAiToolCall>
    }
  }>
}

export class OpenCodeLlmHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
  ) {
    super(`OpenCode Go HTTP ${String(status)}: ${body}`)
    this.name = 'OpenCodeLlmHttpError'
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
        .filter(
          (
            c,
          ): c is {
            type: 'tool_use'
            id: string
            name: string
            input: unknown
          } => c.type === 'tool_use',
        )
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
    const toolResults = message.content.filter(
      (c): c is Extract<LlmContent, { type: 'tool_result' }> =>
        c.type === 'tool_result',
    )
    if (toolResults.length > 0) {
      for (const r of toolResults) {
        out.push({
          role: 'tool',
          tool_call_id: r.toolUseId,
          content: r.content,
        })
      }
      const nonToolResults = message.content.filter(
        (c) => c.type !== 'tool_result',
      )
      if (nonToolResults.length > 0) {
        out.push({
          role: 'user',
          content: contentToOpenAiUserParts(nonToolResults),
        })
      }
      continue
    }
    out.push({
      role: 'user',
      content: contentToOpenAiUserParts(message.content),
    })
  }
  return out
}

const parseToolInput = (raw: string): unknown => {
  if (raw === '') return {}
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

const extractText = (content: ReadonlyArray<LlmContent>): string =>
  content
    .filter(isTextContent)
    .map((c) => c.text)
    .join('')

const responseToAssistantMessage = (
  res: OpenAiChatResponse,
): { message: LlmMessage; finishReason: string; toolCalls: LlmToolCall[] } => {
  const choice = res.choices?.[0]
  const message = choice?.message
  const content: LlmContent[] = []
  if (
    message?.content !== undefined &&
    message.content !== null &&
    message.content !== ''
  ) {
    content.push({ type: 'text', text: message.content })
  }
  const toolCalls: LlmToolCall[] = []
  for (const call of message?.tool_calls ?? []) {
    const input = parseToolInput(call.function.arguments)
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input,
    })
    toolCalls.push({ id: call.id, name: call.function.name, input })
  }
  return {
    message: { role: 'assistant', content },
    finishReason: choice?.finish_reason ?? '',
    toolCalls,
  }
}

export class OpenCodeLlmClient implements LlmClient {
  private readonly apiKey: string
  private readonly baseUrl: string
  private readonly fetchImpl: typeof fetch

  constructor(options: OpenCodeLlmClientOptions) {
    this.apiKey = options.apiKey
    this.baseUrl = options.baseUrl ?? OPENCODE_GO_BASE_URL
    this.fetchImpl = options.fetch ?? fetch
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
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- Wire shape is contractually OpenAI-compatible; full runtime validation would belong in a higher-level guard.
      const json = raw as OpenAiChatResponse
      if (json.choices === undefined || json.choices.length === 0) {
        throw new Error('OpenCode Go returned a response with no choices')
      }
      const {
        message: assistantMessage,
        finishReason,
        toolCalls,
      } = responseToAssistantMessage(json)
      messages = [...messages, assistantMessage]

      if (toolCalls.length === 0 || finishReason !== 'tool_calls') {
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

      const toolResults: LlmContent[] = []
      for (const call of toolCalls) {
        const result = await input.executeTool(call)
        toolResults.push({
          type: 'tool_result',
          toolUseId: call.id,
          content: result.content,
          ...(result.isError === true ? { isError: true } : {}),
        })
      }
      messages = [...messages, { role: 'user', content: toolResults }]
    }

    return { finalText, messages, stopReason, turns }
  }
}
