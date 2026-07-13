// The user message content block shape accepted by
// createMeshiDomainAgent(...).invoke() — shared by both callers that build
// it (src/a2a/message-content.ts for A2A FileParts, and
// src/llm/orchestrator/domain-agent-orchestrator.ts for MCP inputs) so the
// shape is defined once.
export type AgentContentBlock =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly mimeType: string; readonly data: string }
