import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { createAgent, toolStrategy } from 'langchain'

import { meshiAgentResponseSchema } from '#llm/agent/response-schema'
import { MESHI_AGENT_SYSTEM_PROMPT } from '#llm/agent/system-prompt'
import { toLangChainTools } from '#llm/agent/tools'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'

export interface CreateMeshiDomainAgentOptions {
  readonly model: BaseChatModel
  readonly registry: DomainToolsRegistry
  readonly checkpointer: BaseCheckpointSaver
  readonly systemPrompt?: string
}

// The system prompt (system-prompt.ts) has the agent handle each food item
// with its own sequential tool calls, so LangGraph's tick budget (one tick
// per agent-node LLM turn, one per tools-node execution — see
// GRAPH_RECURSION_LIMIT in @langchain/langgraph) grows linearly with item
// count. A worst-case item needs up to 4 tool calls in sequence
// (search_food_master, web_search, register_food_master, record_meal_log),
// i.e. 8 ticks; MAX_MEAL_ITEMS_PER_TURN covers a full day's meals with
// headroom beyond the 12-item request that exhausted LangGraph's default
// limit of 25 (GraphRecursionError, 2026-07-28). +2 covers the final
// meshi_agent_response turn.
const MAX_MEAL_ITEMS_PER_TURN = 25
const MAX_TOOL_CALLS_PER_ITEM = 4
const TICKS_PER_TOOL_CALL = 2
const FINAL_RESPONSE_TICKS = 2

export const MESHI_AGENT_RECURSION_LIMIT =
  MAX_MEAL_ITEMS_PER_TURN * MAX_TOOL_CALLS_PER_ITEM * TICKS_PER_TOOL_CALL +
  FINAL_RESPONSE_TICKS

export const createMeshiDomainAgent = (
  options: CreateMeshiDomainAgentOptions,
) =>
  createAgent({
    model: options.model,
    tools: [...toLangChainTools(options.registry.list())],
    checkpointer: options.checkpointer,
    systemPrompt: options.systemPrompt ?? MESHI_AGENT_SYSTEM_PROMPT,
    responseFormat: toolStrategy(meshiAgentResponseSchema),
  })
