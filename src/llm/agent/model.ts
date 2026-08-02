import { ChatOpenAI } from '@langchain/openai'

import { OPENCODE_GO_BASE_URL } from '#adapters/llm/index'

export interface CreateMeshiChatModelOptions {
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
    // Asks the upstream reasoning model to move chain-of-thought out of
    // `content` into a separate field, so it never reaches the reply text.
    // Whether the gateway forwards this to the underlying provider is
    // unconfirmed, so stripThinkBlocks (see derive-reply.ts) is the actual
    // guarantee against a <think> leak.
    modelKwargs: { reasoning_split: true },
  })
