import { z } from 'zod'

import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import { stripThinkBlocks } from '#llm/agent/strip-think-blocks'

// The minimal surface of a LangChain BaseMessage this module reads out of a
// domain agent's invoke() result — just enough to find the turn's final AI
// message and read its rendered text and tool calls, not the full message
// class hierarchy. `text` mirrors BaseMessage's own `.text` getter (already
// normalizes string vs. content-block array content), and `content` is kept
// separately for callers that need the raw value (e.g. a2a/agent-executor.ts
// parsing a tool message's JSON string content). `args` is read back out
// when a request_user_input call's own reply text comes back empty (see
// request-user-input-tool.ts and deriveAgentReply below).
export interface AgentInvokeMessage {
  readonly getType: () => string
  readonly name?: string
  readonly content: unknown
  readonly text: string
  readonly tool_calls?: ReadonlyArray<{
    readonly name: string
    readonly args?: unknown
  }>
}

export type AgentReplyStatus = 'completed' | 'input_required'

export interface AgentReply {
  readonly status: AgentReplyStatus
  readonly text: string
}

export const AGENT_THINK_BLOCK_LEAKED_EVENT = 'meshi.agent_think_block_leaked'
export const AGENT_QUESTION_TEXT_MISSING_EVENT =
  'meshi.agent_question_text_missing'
export const AGENT_NO_USABLE_REPLY_EVENT = 'meshi.agent_no_usable_reply'

// Shared between a2a/agent-executor.ts and domain-agent-orchestrator.ts so
// both surfaces report the same failure identically.
export const NO_USABLE_REPLY_MESSAGE =
  'The agent did not return a valid response.'
export const buildNoUsableReplyError = (): Error =>
  new Error('domain agent turn produced no usable reply')

// Last-resort question text for when the model called request_user_input
// but left both the reply text and the tool call's own `question` argument
// empty. Should be rare — request-user-input-tool.ts's schema requires
// `question` — but the user must still learn the agent is waiting on them
// rather than see a bare failure.
export const FALLBACK_QUESTION_TEXT =
  "I need more information before I can continue, but couldn't put the question into words this time. Could you share more detail about your last request?"

const requestUserInputArgsSchema = z.object({ question: z.string() })

// Scopes to messages after the turn's own human message — not the whole
// checkpointer-accumulated thread history — so an earlier turn's messages
// can't leak into this turn's derived reply.
export const findTurnMessages = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
): ReadonlyArray<AgentInvokeMessage> => {
  if (messages === undefined) return []
  const turnStart = messages.findLastIndex((m) => m.getType() === 'human')
  if (turnStart === -1) return []
  return messages.slice(turnStart + 1)
}

const findRequestUserInputCall = (
  message: AgentInvokeMessage,
): { readonly args?: unknown } | undefined =>
  (message.tool_calls ?? []).find(
    (call) => call.name === REQUEST_USER_INPUT_TOOL_NAME,
  )

// Reads the turn's reply back out of the raw message list produced by
// createMeshiDomainAgent's ReAct loop: the AI message in the turn carries
// the model's free-form reply directly in its text, and optionally a call
// to request_user_input signaling that the reply is a question the user
// must answer before the agent can proceed (see system-prompt.ts and
// request-user-input-tool.ts). Prefers the AI message that called
// request_user_input over the turn's last one — when the model calls it
// alongside another tool in the same turn, ReactAgent's returnDirect check
// only inspects the single most recent ToolMessage, so the loop continues
// past it and a later AI message becomes "last" without that being a signal
// the input-required reply was withdrawn. When that message's own text is
// empty — the model called request_user_input without also writing the
// reply text the system prompt asks for — falls back to the question
// carried in the tool call's own `question` argument, and finally to
// FALLBACK_QUESTION_TEXT, rather than losing the fact that the agent needs
// an answer to proceed. Returns null only when the turn produced neither
// reply text nor a request_user_input call at all — callers treat that as a
// hard failure (see a2a/agent-executor.ts and domain-agent-orchestrator.ts).
export const deriveAgentReply = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
  onThinkBlockLeaked: () => void,
  onQuestionTextMissing: () => void,
): AgentReply | null => {
  const turnMessages = findTurnMessages(messages)
  const aiMessages = turnMessages.filter((m) => m.getType() === 'ai')
  const replyMessage =
    aiMessages.find((m) => findRequestUserInputCall(m) !== undefined) ??
    aiMessages.at(-1)
  if (replyMessage === undefined) return null

  const { text, stripped } = stripThinkBlocks(replyMessage.text)
  if (stripped) onThinkBlockLeaked()

  const requestUserInputCall = findRequestUserInputCall(replyMessage)
  if (text !== '') {
    return {
      status:
        requestUserInputCall !== undefined ? 'input_required' : 'completed',
      text,
    }
  }
  if (requestUserInputCall === undefined) return null

  onQuestionTextMissing()
  const parsedArgs = requestUserInputArgsSchema.safeParse(
    requestUserInputCall.args,
  )
  const question = parsedArgs.success ? parsedArgs.data.question.trim() : ''
  return {
    status: 'input_required',
    text: question !== '' ? question : FALLBACK_QUESTION_TEXT,
  }
}
