import { MemorySaver } from '@langchain/langgraph'
import { fakeModel } from 'langchain'
import { describe, expect, it } from 'vitest'

import { createMeshiDomainAgent } from '@/llm/agent/domain-agent'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'
import type { DomainTool } from '@/llm/domain-tools/types'
import { err, ok } from '@/llm/domain-tools/types'

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
  it('produces a schema-conformant structuredResponse after calling a domain tool', async () => {
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
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: { status: 'completed', message: 'Recorded your meal.' },
          id: 'call_2',
        },
      ])

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'I ate rice' }] },
      { configurable: { thread_id: 'thread-1' } },
    )

    expect(result.structuredResponse).toEqual({
      status: 'completed',
      message: 'Recorded your meal.',
    })
  })

  it('reports status error when a domain tool call fails', async () => {
    const registry = stubRegistry([
      recordMealLogTool(() =>
        Promise.resolve(
          err({
            code: 'food_master_not_found',
            message: 'unknown food_master_id',
          }),
        ),
      ),
    ])
    const model = fakeModel()
      .respondWithTools([
        {
          name: 'record_meal_log',
          args: { food_master_id: 'fm_missing' },
          id: 'call_1',
        },
      ])
      .respondWithTools([
        {
          name: 'meshi_agent_response',
          args: { status: 'error', message: 'That food could not be found.' },
          id: 'call_2',
        },
      ])

    const agent = createMeshiDomainAgent({
      model,
      registry,
      checkpointer: new MemorySaver(),
    })
    const result = await agent.invoke(
      { messages: [{ role: 'user', content: 'I ate something unknown' }] },
      { configurable: { thread_id: 'thread-2' } },
    )

    expect(result.structuredResponse).toEqual({
      status: 'error',
      message: 'That food could not be found.',
    })
  })
})
