import { ChatOpenAI } from '@langchain/openai'
import { describe, expect, it, vi } from 'vitest'

import { OPENCODE_GO_BASE_URL } from '#adapters/llm/index'
import { createMeshiChatModel } from '#llm/agent/model'

describe('createMeshiChatModel', () => {
  it('returns a ChatOpenAI instance', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model instanceof ChatOpenAI).toEqual(true)
  })

  it('uses the configured model name', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.model).toEqual('test-model')
  })

  it('uses the default base URL', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.clientConfig.baseURL).toEqual(OPENCODE_GO_BASE_URL)
  })

  it('streams responses', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.streaming).toEqual(true)
  })

  it('sets a 45-second request timeout', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })

    expect(model.timeout).toEqual(45_000)
  })

  it('accepts a base URL override', () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
      baseUrl: 'https://example.com/v1',
    })

    expect(model.clientConfig.baseURL).toEqual('https://example.com/v1')
  })

  it('does not retry a failed request', async () => {
    const model = createMeshiChatModel({
      apiKey: 'test-key',
      model: 'test-model',
    })
    const fetch = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('connection failed'))

    try {
      await model.invoke('test prompt').catch(() => undefined)

      expect(fetch.mock.calls.length).toEqual(1)
    } finally {
      fetch.mockRestore()
    }
  })
})
