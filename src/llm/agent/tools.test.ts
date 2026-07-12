import { describe, expect, it } from 'vitest'

import { toLangChainTool, toLangChainTools } from '@/llm/agent/tools'
import type { DomainTool } from '@/llm/domain-tools/types'
import { err, ok } from '@/llm/domain-tools/types'

const stubTool = (execute: DomainTool['execute']): DomainTool => ({
  name: 'record_meal_log',
  description: 'stub tool',
  inputSchema: { type: 'object' },
  execute,
})

describe('toLangChainTool', () => {
  it('wraps the domain tool name, description, and schema', () => {
    const domainTool = stubTool(() => Promise.resolve(ok({ id: '1' })))
    const langChainTool = toLangChainTool(domainTool)

    expect(langChainTool.name).toBe('record_meal_log')
    expect(langChainTool.description).toBe('stub tool')
    expect(langChainTool.schema).toEqual({ type: 'object' })
  })

  it('returns the JSON-encoded value on success', async () => {
    const domainTool = stubTool(() =>
      Promise.resolve(ok({ meal_log_id: 'm1', is_estimated: false })),
    )
    const langChainTool = toLangChainTool(domainTool)

    const result: unknown = await langChainTool.invoke({})

    expect(result).toBe(
      JSON.stringify({ meal_log_id: 'm1', is_estimated: false }),
    )
  })

  it('returns the JSON-encoded {error} envelope on failure', async () => {
    const domainTool = stubTool(() =>
      Promise.resolve(
        err({ code: 'invalid_input', message: 'food_master_id is required' }),
      ),
    )
    const langChainTool = toLangChainTool(domainTool)

    const result: unknown = await langChainTool.invoke({})

    expect(result).toBe(
      JSON.stringify({
        error: {
          code: 'invalid_input',
          message: 'food_master_id is required',
        },
      }),
    )
  })

  it('propagates the input it receives to the domain tool', async () => {
    let received: unknown
    const domainTool = stubTool((input) => {
      received = input
      return Promise.resolve(ok(null))
    })
    const langChainTool = toLangChainTool(domainTool)

    await langChainTool.invoke({ food_master_id: 'fm_1', quantity: 100 })

    expect(received).toEqual({ food_master_id: 'fm_1', quantity: 100 })
  })
})

describe('toLangChainTools', () => {
  it('wraps every domain tool, preserving order', () => {
    const tools = toLangChainTools([
      stubTool(() => Promise.resolve(ok(null))),
      {
        ...stubTool(() => Promise.resolve(ok(null))),
        name: 'search_food_master',
      },
    ])

    expect(tools.map((t) => t.name)).toEqual([
      'record_meal_log',
      'search_food_master',
    ])
  })
})
