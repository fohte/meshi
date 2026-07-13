import type { Span } from '@opentelemetry/api'

// Shapes below follow the GenAI semantic conventions' message format
// (gen_ai.input.messages / gen_ai.output.messages), used by
// genAiCallbackHandler.ts:
// https://github.com/open-telemetry/semantic-conventions-genai/blob/main/docs/gen-ai/gen-ai-spans.md

export interface GenAiTextPart {
  readonly type: 'text'
  readonly content: string
}

export interface GenAiToolCallPart {
  readonly type: 'tool_call'
  readonly id: string
  readonly name: string
  readonly arguments: unknown
}

export interface GenAiToolCallResponsePart {
  readonly type: 'tool_call_response'
  readonly id: string
  readonly response: string
}

export type GenAiMessagePart =
  GenAiTextPart | GenAiToolCallPart | GenAiToolCallResponsePart

export interface GenAiMessage {
  readonly role: string
  readonly parts: ReadonlyArray<GenAiMessagePart>
}

export interface GenAiOutputMessage extends GenAiMessage {
  readonly finish_reason?: string
}

export const recordSpanException = (span: Span, error: unknown): void => {
  span.recordException(error instanceof Error ? error : String(error))
}
