import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { type AnyAgentMiddleware, createAgent } from 'langchain'

import { createRequestUserInputTool } from '#llm/agent/request-user-input-tool'
import { MESHI_AGENT_SYSTEM_PROMPT } from '#llm/agent/system-prompt'
import { toLangChainTools } from '#llm/agent/tools'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'

export interface CreateMeshiDomainAgentOptions {
  readonly model: BaseChatModel
  readonly registry: DomainToolsRegistry
  readonly checkpointer: BaseCheckpointSaver
  readonly systemPrompt?: string
  // Left for the caller to build (e.g. createGenAiTracingMiddleware) rather
  // than constructed in here: this factory takes an arbitrary BaseChatModel,
  // so it has no way to know which provider it's actually talking to —
  // that's known at the composition root (main.ts) where the model itself
  // is built.
  readonly middleware?: ReadonlyArray<AnyAgentMiddleware> | undefined
}

// The system prompt (system-prompt.ts) has the agent handle each food item
// with its own sequential tool calls, so LangGraph's tick budget (one tick
// per agent-node LLM turn, one per tools-node execution — see
// GRAPH_RECURSION_LIMIT in @langchain/langgraph) grows linearly with item
// count. A worst-case item needs up to 4 tool calls in sequence
// (search_food_master, web_search, register_food_master, record_meal_log),
// i.e. 8 ticks; MAX_MEAL_ITEMS_PER_TURN covers a full day's meals with
// headroom beyond LangGraph's default limit of 25. +2 covers the agent's
// final plain-text turn plus an optional request_user_input tool call.
const MAX_MEAL_ITEMS_PER_TURN = 25
const MAX_TOOL_CALLS_PER_ITEM = 4
const TICKS_PER_TOOL_CALL = 2
const FINAL_RESPONSE_TICKS = 2

export const MESHI_AGENT_RECURSION_LIMIT =
  MAX_MEAL_ITEMS_PER_TURN * MAX_TOOL_CALLS_PER_ITEM * TICKS_PER_TOOL_CALL +
  FINAL_RESPONSE_TICKS

export const createMeshiDomainAgent = (
  options: CreateMeshiDomainAgentOptions,
) => {
  // Built as its own binding rather than inline in the createAgent() call
  // below: createAgent's `tools` parameter is a `const`-inferred generic,
  // and inlining this array literal there makes TS infer an overly-specific
  // tuple type from the two different tool() instantiations (domain tools
  // built from a JSON Schema vs. this one built from a zod schema), which
  // fails every createAgent() overload. A pre-computed binding's type is
  // fixed before it reaches that generic, sidestepping the inference.
  const tools = [
    ...toLangChainTools(options.registry.list()),
    createRequestUserInputTool(),
  ]
  return createAgent({
    model: options.model,
    tools,
    checkpointer: options.checkpointer,
    systemPrompt: options.systemPrompt ?? MESHI_AGENT_SYSTEM_PROMPT,
    middleware: options.middleware ?? [],
  })
}
