import { ChatOpenAI } from '@langchain/openai'

import {
  GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
  GenAiCallbackHandler,
  OPENCODE_GO_BASE_URL,
} from '#adapters/llm/index'

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
): ChatOpenAI => {
  const genAiCallbackHandler = new GenAiCallbackHandler({
    providerName: GEN_AI_PROVIDER_NAME_VALUE_OPENCODE,
    ...(options.captureMessageContent === undefined
      ? {}
      : { captureMessageContent: options.captureMessageContent }),
  })
  return new ChatOpenAI({
    model: options.model,
    apiKey: options.apiKey,
    configuration: {
      baseURL: options.baseUrl ?? OPENCODE_GO_BASE_URL,
      // Routes the client's HTTP request through GenAiCallbackHandler's
      // active span so instrumentation-undici's request span becomes its
      // child instead of an unrelated root (see wrapFetch for why the
      // callback handler's own context.with() can't do this by itself).
      fetch: genAiCallbackHandler.wrapFetch(fetch),
    },
    callbacks: [genAiCallbackHandler],
    // Asks the upstream reasoning model to move chain-of-thought out of
    // `content` into a separate field, so it never reaches the reply text.
    // Whether the gateway forwards this to the underlying provider is
    // unconfirmed, so stripThinkBlocks (see derive-reply.ts) is the actual
    // guarantee against a <think> leak.
    modelKwargs: { reasoning_split: true },
  })
}
