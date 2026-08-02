import { ChatOpenAI } from '@langchain/openai'
import { describe, expect, it } from 'vitest'

import { OPENCODE_GO_BASE_URL } from '#adapters/llm/index'
import { createMeshiChatModel } from '#llm/agent/model'

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

  it('asks the upstream model to split reasoning out of content', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.modelKwargs).toEqual({ reasoning_split: true })
  })
})
