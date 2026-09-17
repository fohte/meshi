import { ChatOpenAI } from '@langchain/openai'

import { OPENCODE_GO_BASE_URL } from '#adapters/llm/index'

interface CreateMeshiChatModelOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseUrl?: string
}

export const createMeshiChatModel = (
  options: CreateMeshiChatModelOptions,
): ChatOpenAI =>
  new ChatOpenAI({
    model: options.model,
    apiKey: options.apiKey,
    configuration: {
      baseURL: options.baseUrl ?? OPENCODE_GO_BASE_URL,
    },
  })
