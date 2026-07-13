export const OPENCODE_GO_BASE_URL = 'https://opencode.ai/zen/go/v1'

// Identifies the OpenCode Go gateway's telemetry provider name (OpenCode Go
// proxies to multiple underlying model providers, so this is the gateway
// being called, not the resolved model's own provider). Shared by every
// OpenCode Go-backed client (e.g. the LangChain ChatOpenAI wiring in
// src/llm/agent/model.ts) so they report the same gen_ai.provider.name.
export const GEN_AI_PROVIDER_NAME_VALUE_OPENCODE = 'opencode'
