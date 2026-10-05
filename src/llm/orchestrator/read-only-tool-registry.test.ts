import { describe, expect, it } from 'vitest'

import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import type { DomainTool, DomainToolName } from '#llm/domain-tools/types'
import { ok } from '#llm/domain-tools/types'
import { restrictToReadOnly } from '#llm/orchestrator/read-only-tool-registry'

const stubRegistry = (
  tools: ReadonlyArray<DomainTool>,
): DomainToolsRegistry => ({
  list: () => tools,
  get: (name) => tools.find((tool) => tool.name === name),
  toLlmSchemas: () =>
    tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  executeToolUse: () => Promise.reject(new Error('not used in this test')),
})

const stubTool = (
  name: DomainToolName,
  execute: DomainTool['execute'],
): DomainTool => ({
  name,
  description: `stub ${name}`,
  inputSchema: { type: 'object' },
  execute,
})

const fullDomainToolsRegistry = (): DomainToolsRegistry =>
  stubRegistry([
    stubTool('record_meal_log', () => Promise.resolve(ok({}))),
    stubTool('update_meal_log', () => Promise.resolve(ok({}))),
    stubTool('record_meal_skip', () => Promise.resolve(ok({}))),
    stubTool('cancel_meal_skip', () => Promise.resolve(ok({}))),
    stubTool('search_food_master', () => Promise.resolve(ok({}))),
    stubTool('register_food_master', () => Promise.resolve(ok({}))),
    stubTool('register_food_master_from_composition', () =>
      Promise.resolve(ok({})),
    ),
    stubTool('merge_food_master', () => Promise.resolve(ok({}))),
    stubTool('query_meal_history', () => Promise.resolve(ok({}))),
    stubTool('get_user_profile', () => Promise.resolve(ok({}))),
    stubTool('update_user_profile', () => Promise.resolve(ok({}))),
    stubTool('web_search', () => Promise.resolve(ok({}))),
  ])

describe('restrictToReadOnly', () => {
  it('keeps list() to the read-only tools', () => {
    const restricted = restrictToReadOnly(fullDomainToolsRegistry())

    expect(restricted.list().map((tool) => tool.name)).toEqual([
      'search_food_master',
      'query_meal_history',
      'get_user_profile',
      'web_search',
    ])
  })

  it('keeps schemas to the same read-only tools', () => {
    const restricted = restrictToReadOnly(fullDomainToolsRegistry())

    expect(restricted.toLlmSchemas()).toEqual([
      {
        name: 'search_food_master',
        description: 'stub search_food_master',
        inputSchema: { type: 'object' },
      },
      {
        name: 'query_meal_history',
        description: 'stub query_meal_history',
        inputSchema: { type: 'object' },
      },
      {
        name: 'get_user_profile',
        description: 'stub get_user_profile',
        inputSchema: { type: 'object' },
      },
      {
        name: 'web_search',
        description: 'stub web_search',
        inputSchema: { type: 'object' },
      },
    ])
  })

  it('returns undefined for a write tool name', () => {
    const restricted = restrictToReadOnly(fullDomainToolsRegistry())

    expect(restricted.get('record_meal_log')).toBeUndefined()
  })
})
