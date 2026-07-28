import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import { stripThinkBlocks } from '#llm/agent/strip-think-blocks'

// The minimal surface of a LangChain BaseMessage this module reads out of a
// domain agent's invoke() result — just enough to find the turn's final AI
// message and read its rendered text and tool calls, not the full message
// class hierarchy. `text` mirrors BaseMessage's own `.text` getter (already
// normalizes string vs. content-block array content), and `content` is kept
// separately for callers that need the raw value (e.g. a2a/agent-executor.ts
// parsing a tool message's JSON string content).
export interface AgentInvokeMessage {
  readonly getType: () => string
  readonly name?: string
  readonly content: unknown
  readonly text: string
  readonly tool_calls?: ReadonlyArray<{ readonly name: string }>
}

export type AgentReplyStatus = 'completed' | 'input_required'

export interface AgentReply {
  readonly status: AgentReplyStatus
  readonly text: string
}

export const AGENT_THINK_BLOCK_LEAKED_EVENT = 'meshi.agent_think_block_leaked'
export const AGENT_NO_USABLE_REPLY_EVENT = 'meshi.agent_no_usable_reply'

// Shared between a2a/agent-executor.ts and domain-agent-orchestrator.ts so
// both surfaces report the same failure identically.
export const NO_USABLE_REPLY_MESSAGE =
  'The agent did not return a valid response.'
export const buildNoUsableReplyError = (): Error =>
  new Error('domain agent turn produced no usable reply')

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

const callsRequestUserInput = (message: AgentInvokeMessage): boolean =>
  (message.tool_calls ?? []).some(
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
// the input-required reply was withdrawn. Returns null when the turn
// produced no usable text at all — callers treat this as a hard failure
// (see a2a/agent-executor.ts and domain-agent-orchestrator.ts).
export const deriveAgentReply = (
  messages: ReadonlyArray<AgentInvokeMessage> | undefined,
  onThinkBlockLeaked: () => void,
): AgentReply | null => {
  const turnMessages = findTurnMessages(messages)
  const aiMessages = turnMessages.filter((m) => m.getType() === 'ai')
  const replyMessage =
    aiMessages.find(callsRequestUserInput) ?? aiMessages.at(-1)
  if (replyMessage === undefined) return null

  const { text, stripped } = stripThinkBlocks(replyMessage.text)
  if (stripped) onThinkBlockLeaked()
  if (text === '') return null

  return {
    status: callsRequestUserInput(replyMessage)
      ? 'input_required'
      : 'completed',
    text,
  }
}
