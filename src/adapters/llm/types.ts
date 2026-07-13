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
