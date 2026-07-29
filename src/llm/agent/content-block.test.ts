import { convertMessagesToCompletionsMessageParams } from '@langchain/openai'
import { describe, expect, it } from 'vitest'

import { toHumanMessage } from '#llm/agent/content-block'

describe('toHumanMessage', () => {
  it('builds a message the OpenAI Chat Completions converter recognizes as containing an image', () => {
    const message = toHumanMessage([
      { type: 'text', text: 'what is this?' },
      { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    ])

    const params = convertMessagesToCompletionsMessageParams({
      messages: [message],
      model: 'gpt-4o',
    })

    expect(params).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          {
            type: 'image_url',
            image_url: { url: 'data:image/png;base64,aGVsbG8=' },
          },
        ],
      },
    ])
  })
})
