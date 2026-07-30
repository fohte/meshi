import { HumanMessage } from '@langchain/core/messages'

// The user message content block shape accepted by
// createMeshiDomainAgent(...).invoke() — shared by both callers that build
// it (src/a2a/message-content.ts for A2A FileParts, and
// src/llm/orchestrator/domain-agent-orchestrator.ts for MCP inputs) so the
// shape is defined once.
export type AgentContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }

// Shared by both callers that ground the LLM in the current date/time
// (src/a2a/message-content.ts's caller for the A2A path, and
// domain-agent-orchestrator.ts for the MCP path) so the wire format
// MESHI_AGENT_SYSTEM_PROMPT documents for the LLM can't drift between them.
export const formatPromptMeta = (
  occurredAt: Date | undefined,
  timezone: string | undefined,
): string => {
  const parts: string[] = []
  if (occurredAt !== undefined) {
    parts.push(`occurred_at=${occurredAt.toISOString()}`)
  }
  if (timezone !== undefined && timezone !== '') {
    parts.push(`timezone=${timezone}`)
  }
  return parts.length === 0 ? '' : `(meta: ${parts.join(', ')})`
}

// contentBlocks (not content) is required for @langchain/openai to
// recognize these as standard v1 content blocks: it sets
// response_metadata.output_version = 'v1', which the Chat Completions
// converter keys off of to route an image block through standard-block
// conversion (image -> image_url) instead of treating it as unrecognized
// provider-native content and dropping it.
export const toHumanMessage = (
  contentBlocks: ReadonlyArray<AgentContentBlock>,
): HumanMessage => new HumanMessage({ contentBlocks: [...contentBlocks] })
