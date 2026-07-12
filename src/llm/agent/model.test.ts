import { ChatOpenAI } from '@langchain/openai'
import { describe, expect, it } from 'vitest'

import { GenAiCallbackHandler, OPENCODE_GO_BASE_URL } from '@/adapters/llm'
import { createMeshiChatModel } from '@/llm/agent/model'

describe('createMeshiChatModel', () => {
  it('builds a ChatOpenAI defaulted to the OpenCode Go base URL', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model).toBeInstanceOf(ChatOpenAI)
    expect(model.model).toBe('test-model')
    expect(model.clientConfig.baseURL).toBe(OPENCODE_GO_BASE_URL)
  })

  it('accepts a base URL override', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
    })

    expect(model.clientConfig.baseURL).toBe('https://example.com/v1')
  })

  it('attaches a GenAiCallbackHandler so LLM calls emit gen_ai.* spans', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.callbacks).toEqual([expect.any(GenAiCallbackHandler)])
  })
})
