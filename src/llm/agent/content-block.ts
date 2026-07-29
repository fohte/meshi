import { HumanMessage } from '@langchain/core/messages'

// The user message content block shape accepted by
// createMeshiDomainAgent(...).invoke() — shared by both callers that build
// it (src/a2a/message-content.ts for A2A FileParts, and
// src/llm/orchestrator/domain-agent-orchestrator.ts for MCP inputs) so the
// shape is defined once.
export type AgentContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }

// contentBlocks (not content) is required for @langchain/openai to
// recognize these as standard v1 content blocks: it sets
// response_metadata.output_version = 'v1', which the Chat Completions
// converter keys off of to route an image block through standard-block
// conversion (image -> image_url) instead of treating it as unrecognized
// provider-native content and dropping it.
export const toHumanMessage = (
  contentBlocks: ReadonlyArray<AgentContentBlock>,
): HumanMessage => new HumanMessage({ contentBlocks: [...contentBlocks] })
