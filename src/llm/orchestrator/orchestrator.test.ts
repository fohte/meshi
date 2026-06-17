import { describe, expect, it } from 'vitest'

import type {
  LlmClient,
  LlmContent,
  LlmMessage,
  LlmRunInput,
  LlmRunOutput,
  LlmStopReason,
  LlmToolCall,
  LlmToolExecutionResult,
} from '@/adapters/llm/types'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'
import type { DomainTool } from '@/llm/domain-tools/types'
import { err, ok } from '@/llm/domain-tools/types'
import { createConversationOrchestrator } from '@/llm/orchestrator/orchestrator'
import type {
  MealHistoryResult,
  MealRecordResult,
  RecommendResult,
} from '@/llm/orchestrator/types'

interface ScriptedToolCall {
  readonly name: string
  readonly input: Readonly<Record<string, unknown>>
}

type ScriptedStep =
  | { readonly type: 'tools'; readonly calls: ReadonlyArray<ScriptedToolCall> }
  | { readonly type: 'final'; readonly text: string }

const createScriptedLlmClient = (
  steps: ReadonlyArray<ScriptedStep>,
): LlmClient => {
  return {
    async runConversation(input: LlmRunInput): Promise<LlmRunOutput> {
      let messages: LlmMessage[] = [...input.messages]
      let turns = 0
      let finalText = ''
      let stopReason: LlmStopReason = 'max_turns'
      let nextCallId = 0
      for (const step of steps) {
        if (turns >= input.maxTurns) {
          stopReason = 'max_turns'
          break
        }
        turns++
        if (step.type === 'final') {
          messages = [
            ...messages,
            {
              role: 'assistant',
              content: [{ type: 'text', text: step.text }],
            },
          ]
          finalText = step.text
          stopReason = 'end'
          return { finalText, messages, stopReason, turns }
        }
        const assistantContent: LlmContent[] = step.calls.map((c) => ({
          type: 'tool_use',
          id: `t${String(++nextCallId)}`,
          name: c.name,
          input: c.input,
        }))
        messages = [
          ...messages,
          { role: 'assistant', content: assistantContent },
        ]
        if (turns >= input.maxTurns) {
          stopReason = 'max_turns'
          break
        }
        const toolResults: LlmContent[] = []
        for (const block of assistantContent) {
          if (block.type !== 'tool_use') continue
          const call: LlmToolCall = {
            id: block.id,
            name: block.name,
            input: block.input,
          }
          let execResult: LlmToolExecutionResult
          try {
            execResult = await input.executeTool(call)
          } catch (e) {
            execResult = {
              content: e instanceof Error ? e.message : String(e),
              isError: true,
            }
          }
          toolResults.push({
            type: 'tool_result',
            toolUseId: block.id,
            content: execResult.content,
            ...(execResult.isError === true ? { isError: true } : {}),
          })
        }
        messages = [...messages, { role: 'user', content: toolResults }]
      }
      return { finalText, messages, stopReason, turns }
    },
  }
}

type FakeResult =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false
      readonly error: { readonly code: string; readonly message: string }
    }

interface FakeTool {
  readonly name: string
  readonly handle: (input: unknown) => FakeResult
}

const createFakeRegistry = (
  fakeTools: ReadonlyArray<FakeTool>,
): DomainToolsRegistry => {
  const tools: ReadonlyArray<DomainTool> = fakeTools.map((t) => ({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tests supply tool names that match the union; widening to string would defeat the type.
    name: t.name as DomainTool['name'],
    description: `fake ${t.name}`,
    inputSchema: { type: 'object' },
    execute: (input) => Promise.resolve(t.handle(input)),
  }))
  const byName = new Map<string, DomainTool>(tools.map((t) => [t.name, t]))
  return {
    list: () => tools,
    get: (name) => byName.get(name),
    toLlmSchemas: () =>
      tools.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })),
    executeToolUse(call) {
      const tool = byName.get(call.name)
      if (tool === undefined) {
        return Promise.resolve({
          content: JSON.stringify({
            error: { code: 'unknown_tool', message: 'unknown' },
          }),
          isError: true,
        })
      }
      return tool.execute(call.input).then((r) => {
        if (r.ok) return { content: JSON.stringify(r.value) }
        return { content: JSON.stringify({ error: r.error }), isError: true }
      })
    },
  }
}

const baseOptions = {
  textModel: 'text-model',
  visionModel: 'vision-model',
  maxTurns: 6,
}

const normalizeMealRecord = (r: MealRecordResult): MealRecordResult => r

describe('ConversationOrchestrator', () => {
  it('records a meal via record_meal_log and returns recorded + summary', async () => {
    const calls: Array<{ name: string; input: unknown }> = []
    const registry = createFakeRegistry([
      {
        name: 'record_meal_log',
        handle(input) {
          calls.push({ name: 'record_meal_log', input })
          return ok({
            meal_log_id: 'log_1',
            nutrition: { energy_kcal: 250 },
            is_estimated: false,
          })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [
          {
            name: 'record_meal_log',
            input: {
              food_master_id: 'fm_1',
              eaten_at_iso: '2026-06-18T12:00:00+09:00',
              quantity: 1,
              unit: '杯',
            },
          },
        ],
      },
      { type: 'final', text: 'Recorded.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result = await orchestrator.recordFromText({
      text: 'ラーメンを食べた',
    })

    expect(normalizeMealRecord(result)).toEqual({
      recorded: [
        {
          mealLogId: 'log_1',
          foodMasterId: 'fm_1',
          nutrition: { energy_kcal: 250 },
          isEstimated: false,
        },
      ],
      candidates: [],
      hasEstimatedValues: false,
      summaryText: 'Recorded.',
      error: null,
    })
    expect(calls).toEqual([
      {
        name: 'record_meal_log',
        input: {
          food_master_id: 'fm_1',
          eaten_at_iso: '2026-06-18T12:00:00+09:00',
          quantity: 1,
          unit: '杯',
        },
      },
    ])
  })

  it('drives an on-demand registration flow (search → web_search → register → record)', async () => {
    const registry = createFakeRegistry([
      {
        name: 'search_food_master',
        handle() {
          return ok({ candidates: [] })
        },
      },
      {
        name: 'web_search',
        handle() {
          return ok({
            snippets: [
              {
                title: 'Recipe',
                url: 'https://example.com/recipe',
                text: 'energy 320 kcal',
              },
            ],
          })
        },
      },
      {
        name: 'register_food_master',
        handle() {
          return ok({ food_master_id: 'fm_new', is_estimated: false })
        },
      },
      {
        name: 'record_meal_log',
        handle() {
          return ok({
            meal_log_id: 'log_42',
            nutrition: { energy_kcal: 320 },
            is_estimated: false,
          })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [
          { name: 'search_food_master', input: { query: 'foo', limit: 5 } },
        ],
      },
      {
        type: 'tools',
        calls: [{ name: 'web_search', input: { query: 'foo nutrition' } }],
      },
      {
        type: 'tools',
        calls: [
          {
            name: 'register_food_master',
            input: { name: 'foo', source: 'web_search' },
          },
        ],
      },
      {
        type: 'tools',
        calls: [
          {
            name: 'record_meal_log',
            input: {
              food_master_id: 'fm_new',
              eaten_at_iso: '2026-06-18T12:00:00+09:00',
              quantity: 1,
              unit: 'serving',
            },
          },
        ],
      },
      { type: 'final', text: 'Recorded foo.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result = await orchestrator.recordFromText({ text: 'foo を食べた' })

    expect(result).toEqual({
      recorded: [
        {
          mealLogId: 'log_42',
          foodMasterId: 'fm_new',
          nutrition: { energy_kcal: 320 },
          isEstimated: false,
        },
      ],
      candidates: [],
      hasEstimatedValues: false,
      summaryText: 'Recorded foo.',
      error: null,
    })
  })

  it('returns candidates with empty recorded when the food cannot be uniquely identified', async () => {
    const registry = createFakeRegistry([
      {
        name: 'search_food_master',
        handle() {
          return ok({
            candidates: [
              {
                food_master_id: 'fm_a',
                composition_code: null,
                name: 'Apple Pie',
                is_estimated: false,
                score: 0.9,
                reason: 'history_recent',
              },
              {
                food_master_id: 'fm_b',
                composition_code: null,
                name: 'Apple',
                is_estimated: true,
                score: 0.7,
                reason: 'fuzzy_name',
              },
            ],
          })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'apple' } }],
      },
      {
        type: 'final',
        text: 'I am not sure which apple you mean.',
      },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result = await orchestrator.recordFromText({ text: 'apple' })

    expect(result).toEqual({
      recorded: [],
      candidates: [
        {
          foodMasterId: 'fm_a',
          compositionCode: null,
          name: 'Apple Pie',
          isEstimated: false,
          score: 0.9,
          reason: 'history_recent',
        },
        {
          foodMasterId: 'fm_b',
          compositionCode: null,
          name: 'Apple',
          isEstimated: true,
          score: 0.7,
          reason: 'fuzzy_name',
        },
      ],
      hasEstimatedValues: false,
      summaryText: 'I am not sure which apple you mean.',
      error: null,
    })
  })

  it('returns max_turns_exceeded error when the loop hits the cap', async () => {
    const registry = createFakeRegistry([
      {
        name: 'search_food_master',
        handle() {
          return ok({ candidates: [] })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'a' } }],
      },
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'b' } }],
      },
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'c' } }],
      },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
      maxTurns: 2,
    })

    const result = await orchestrator.recordFromText({ text: 'x' })

    expect(result).toEqual({
      recorded: [],
      candidates: [],
      hasEstimatedValues: false,
      summaryText:
        'The internal LLM loop reached the maximum number of turns without finishing.',
      error: {
        kind: 'max_turns_exceeded',
        message:
          'The internal LLM loop reached the maximum number of turns without finishing.',
      },
    })
  })

  it('detects divergence when the same tool is called with the same input twice in a row', async () => {
    let invocations = 0
    const registry = createFakeRegistry([
      {
        name: 'search_food_master',
        handle() {
          invocations++
          return ok({ candidates: [] })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'foo' } }],
      },
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'foo' } }],
      },
      { type: 'final', text: 'Giving up.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result = await orchestrator.recordFromText({ text: 'foo' })

    expect(result).toEqual({
      recorded: [],
      candidates: [],
      hasEstimatedValues: false,
      summaryText:
        'Divergence detected: you called the same tool with the same arguments twice in a row. Stop calling tools and return your final answer.',
      error: {
        kind: 'divergence_detected',
        message:
          'Divergence detected: you called the same tool with the same arguments twice in a row. Stop calling tools and return your final answer.',
      },
    })
    expect(invocations).toBe(1)
  })

  it('queryMeals returns the aggregate from the last query_meal_history call', async () => {
    const registry = createFakeRegistry([
      {
        name: 'query_meal_history',
        handle() {
          return ok({
            totals: { energy_kcal: 1800 },
            per_day: [
              { date: '2026-06-17', totals: { energy_kcal: 900 } },
              { date: '2026-06-18', totals: { energy_kcal: 900 } },
            ],
            entries: [
              {
                meal_log_id: 'log_1',
                food_master_id: 'fm_1',
                eaten_at_iso: '2026-06-17T12:00:00Z',
                quantity: 1,
                unit: '杯',
                note: null,
              },
            ],
            has_estimated_values: true,
          })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [
          {
            name: 'query_meal_history',
            input: {
              period_from_iso: '2026-06-17T00:00:00Z',
              period_to_iso: '2026-06-19T00:00:00Z',
            },
          },
        ],
      },
      { type: 'final', text: '1800 kcal over 2 days.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result: MealHistoryResult = await orchestrator.queryMeals({
      query: '直近 2 日',
    })

    expect(result).toEqual({
      aggregate: {
        totals: { energy_kcal: 1800 },
        perDay: [
          { date: '2026-06-17', totals: { energy_kcal: 900 } },
          { date: '2026-06-18', totals: { energy_kcal: 900 } },
        ],
        entries: [
          {
            mealLogId: 'log_1',
            foodMasterId: 'fm_1',
            eatenAtIso: '2026-06-17T12:00:00Z',
            quantity: 1,
            unit: '杯',
            note: null,
          },
        ],
        hasEstimatedValues: true,
      },
      hasEstimatedValues: true,
      summaryText: '1800 kcal over 2 days.',
      error: null,
    })
  })

  it('recommendMeal returns the final assistant text', async () => {
    const registry = createFakeRegistry([
      {
        name: 'get_user_profile',
        handle() {
          return ok({ likes: [], dislikes: [], allergies: [], constraints: [] })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [{ name: 'get_user_profile', input: {} }],
      },
      { type: 'final', text: 'Try a salad.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result: RecommendResult = await orchestrator.recommendMeal({})

    expect(result).toEqual({
      summaryText: 'Try a salad.',
      error: null,
    })
  })

  it('propagates a tool error result back to the LLM so it can recover', async () => {
    const registry = createFakeRegistry([
      {
        name: 'search_food_master',
        handle() {
          return err({ code: 'transient', message: 'db blip' })
        },
      },
    ])
    const llm = createScriptedLlmClient([
      {
        type: 'tools',
        calls: [{ name: 'search_food_master', input: { query: 'x' } }],
      },
      { type: 'final', text: 'Could not search right now.' },
    ])
    const orchestrator = createConversationOrchestrator({
      llmClient: llm,
      registry,
      ...baseOptions,
    })

    const result = await orchestrator.recordFromText({ text: 'x' })

    expect(result).toEqual({
      recorded: [],
      candidates: [],
      hasEstimatedValues: false,
      summaryText: 'Could not search right now.',
      error: null,
    })
  })
})
