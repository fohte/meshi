export interface LlmTextContent {
  readonly type: 'text'
  readonly text: string
}

export interface LlmImageContent {
  readonly type: 'image'
  readonly mimeType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp'
  readonly base64: string
}

export interface LlmToolUseContent {
  readonly type: 'tool_use'
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export interface LlmToolResultContent {
  readonly type: 'tool_result'
  readonly toolUseId: string
  readonly content: string
  readonly isError?: boolean
}

export type LlmContent =
  LlmTextContent | LlmImageContent | LlmToolUseContent | LlmToolResultContent

export interface LlmMessage {
  readonly role: 'user' | 'assistant'
  readonly content: ReadonlyArray<LlmContent>
}

export interface LlmToolSchema {
  readonly name: string
  readonly description: string
  readonly inputSchema: Readonly<Record<string, unknown>>
}

export interface LlmToolCall {
  readonly id: string
  readonly name: string
  readonly input: unknown
}

export interface LlmToolExecutionResult {
  readonly content: string
  readonly isError?: boolean
}

export type LlmToolExecutor = (
  call: LlmToolCall,
) => Promise<LlmToolExecutionResult>

export interface LlmRunInput {
  readonly model: string
  readonly system: string
  readonly messages: ReadonlyArray<LlmMessage>
  readonly tools: ReadonlyArray<LlmToolSchema>
  readonly maxTurns: number
  readonly executeTool: LlmToolExecutor
}

export type LlmStopReason = 'end' | 'max_turns'

export interface LlmRunOutput {
  readonly finalText: string
  readonly messages: ReadonlyArray<LlmMessage>
  readonly stopReason: LlmStopReason
  readonly turns: number
}

export interface LlmClient {
  runConversation(input: LlmRunInput): Promise<LlmRunOutput>
}
