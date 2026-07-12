import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { createAgent, toolStrategy } from 'langchain'

import { meshiAgentResponseSchema } from '@/llm/agent/response-schema'
import { MESHI_AGENT_SYSTEM_PROMPT } from '@/llm/agent/system-prompt'
import { toLangChainTools } from '@/llm/agent/tools'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'

export interface CreateMeshiDomainAgentOptions {
  readonly model: BaseChatModel
  readonly registry: DomainToolsRegistry
  readonly checkpointer: BaseCheckpointSaver
  readonly systemPrompt?: string
}

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
