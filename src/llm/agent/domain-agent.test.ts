import { AIMessage } from '@langchain/core/messages'
import { MemorySaver } from '@langchain/langgraph'
import { fakeModel } from 'langchain'
import { describe, expect, it } from 'vitest'

import { createMeshiDomainAgent } from '#llm/agent/domain-agent'
import { REQUEST_USER_INPUT_TOOL_NAME } from '#llm/agent/request-user-input-tool'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool } from '#llm/domain-tools/types'
import { ok } from '#llm/domain-tools/types'

const stubRegistry = (
  tools: ReadonlyArray<DomainTool>,
): DomainToolsRegistry => ({
  list: () => tools,
  get: (name) => tools.find((t) => t.name === name),
  toLlmSchemas: () =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  executeToolUse: () => {
    throw new Error('not used by createMeshiDomainAgent')
  },
})

const recordMealLogTool = (execute: DomainTool['execute']): DomainTool => ({
  name: 'record_meal_log',
  description: 'Records a meal log entry.',
  inputSchema: { type: 'object' },
  execute,
})

describe('createMeshiDomainAgent', () => {
  it('runs a domain tool call and returns the reply text as the final AI message', async () => {
    const registry = stubRegistry([
      recordMealLogTool(() =>
        Promise.resolve(ok({ meal_log_id: 'm1', is_estimated: false })),
      ),
    ])
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: { food_master_id: 'fm_1' },
          id: 'call_1',
        },
      ])
      .respond(new AIMessage('Recorded your meal.'))

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'I ate rice' }] },
      { configurable: { thread_id: 'thread-1' } },
    )

    expect(result.messages.at(-1)?.text).toBe('Recorded your meal.')
  })

  it('ends the turn right after calling request_user_input, without a further model turn', async () => {
    const registry = stubRegistry([])
    const model = fakeModel().respond(
      new AIMessage({
        content: 'Which food did you mean?',
        tool_calls: [
          {
            name: REQUEST_USER_INPUT_TOOL_NAME,
            args: {},
            id: 'call_1',
            type: 'tool_call',
          },
        ],
      }),
    )

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'salmon' }] },
      { configurable: { thread_id: 'thread-2' } },
    )

    expect(model.callCount).toBe(1)
    expect(result.messages.at(-1)?.type).toBe('tool')
    const aiMessages = result.messages.filter((m) => m.type === 'ai')
    expect(aiMessages).toHaveLength(1)
    expect(aiMessages[0]?.text).toBe('Which food did you mean?')
  })
})
