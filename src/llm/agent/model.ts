import { ChatOpenAI } from '@langchain/openai'

import {
  GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
  GenAiCallbackHandler,
  OPENCODE_GO_BASE_URL,
} from '@/adapters/llm'

export interface CreateMeshiChatModelOptions {
  readonly apiKey: string
  readonly model: string
  readonly baseUrl?: string
  readonly captureMessageContent?: boolean
}

// The GenAiCallbackHandler is attached here, on the model itself, rather
// than left for callers to pass via invoke-time config: createMeshiDomainAgent
// (and createAgent in general) has no top-level `callbacks` option, and
// attaching it to the model guarantees every inference call made through it
// gets a gen_ai.* span regardless of how the agent is later invoked.
export const createMeshiChatModel = (
  options: CreateMeshiChatModelOptions,
): ChatOpenAI =>
  new ChatOpenAI({
    model: options.model,
    apiKey: options.apiKey,
    configuration: { baseURL: options.baseUrl ?? OPENCODE_GO_BASE_URL },
    callbacks: [
      new GenAiCallbackHandler({
        providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
        ...(options.captureMessageContent === undefined
          ? {}
          : { captureMessageContent: options.captureMessageContent }),
      }),
    ],
  })
