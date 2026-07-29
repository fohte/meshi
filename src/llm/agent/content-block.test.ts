import { HumanMessage } from '@langchain/core/messages'
import { convertMessagesToCompletionsMessageParams } from '@langchain/openai'
import { describe, expect, it } from 'vitest'

import type { AgentContentBlock } from '#llm/agent/content-block'

const IMAGE_BLOCKS: ReadonlyArray<AgentContentBlock> = [
  { type: 'text', text: 'what is this?' },
  { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
]

describe('AgentContentBlock as seen by the OpenAI Chat Completions converter', () => {
  it('converts an image block to image_url when the message is built via contentBlocks', () => {
    // Mirrors how runAgentTurn (agent-executor.ts) and
    // createDomainAgentOrchestrator's runTurn (domain-agent-orchestrator.ts)
    // build the user message for agent.invoke().
    const message = new HumanMessage({ contentBlocks: [...IMAGE_BLOCKS] })

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

  // A HumanMessage built via `content` (instead of `contentBlocks`) never
  // sets response_metadata.output_version = 'v1', so the converter falls
  // back to its legacy path, which only recognizes source_type-tagged data
  // content blocks — AgentContentBlock's image shape passes through
  // unconverted and would silently reach the provider as an unrecognized
  // content part.
  it('leaves an image block unconverted when the message is built via content', () => {
    const message = new HumanMessage({ content: [...IMAGE_BLOCKS] })

    const params = convertMessagesToCompletionsMessageParams({
      messages: [message],
      model: 'gpt-4o',
    })

    expect(params).toEqual([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
        ],
      },
    ])
  })
})
