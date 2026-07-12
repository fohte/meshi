import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { meshiAgentResponseSchema } from '@/llm/agent/response-schema'

describe('meshiAgentResponseSchema', () => {
  it('has a stable JSON Schema title so toolStrategy names its tool deterministically', () => {
    const jsonSchema = z.toJSONSchema(meshiAgentResponseSchema)

    expect(jsonSchema.title).toBe('meshi_agent_response')
  })

  it('accepts a valid status and message', () => {
    const parsed = meshiAgentResponseSchema.safeParse({
      status: 'completed',
      message: 'hello',
    })
    expect(parsed.success).toBe(true)
  })

  it('rejects an unknown status', () => {
    const parsed = meshiAgentResponseSchema.safeParse({
      status: 'done',
      message: 'hello',
    })
    expect(parsed.success).toBe(false)
  })
})
