import { randomUUID } from 'node:crypto'

import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph'

import type { AgentContentBlock } from '@/llm/agent/content-block'
import { createMeshiDomainAgent } from '@/llm/agent/domain-agent'
import {
  type MeshiAgentResponse,
  meshiAgentResponseSchema,
} from '@/llm/agent/response-schema'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'
import type { QueryMealHistoryOutput } from '@/llm/domain-tools/tools/query-meal-history'
import type { RecordMealLogOutput } from '@/llm/domain-tools/tools/record-meal-log'
import type { SearchFoodMasterOutput } from '@/llm/domain-tools/tools/search-food-master'
import type { DomainTool } from '@/llm/domain-tools/types'
import {
  createPassthroughReplyFormatter,
  type ReplyFormatter,
} from '@/llm/orchestrator/reply-formatter'
import type {
  ConversationOrchestrator,
  FoodCandidate,
  MealHistoryAggregateSnapshot,
  MealHistoryResult,
  MealRecordResult,
  OrchestratorError,
  QueryMealsInput,
  RecommendInput,
  RecommendResult,
  RecordedMeal,
  RecordFromImageInput,
  RecordFromTextInput,
} from '@/llm/orchestrator/types'

export interface DomainAgentOrchestratorOptions {
  readonly model: BaseChatModel
  readonly registry: DomainToolsRegistry
  readonly formatter?: ReplyFormatter
}

interface RecordedInvocation {
  readonly name: string
  readonly input: unknown
  // null when the tool call itself failed.
  readonly value: unknown
}

const wrapTool = (
  tool: DomainTool,
  invocations: RecordedInvocation[],
): DomainTool => ({
  ...tool,
  async execute(input) {
    const result = await tool.execute(input)
    invocations.push({
      name: tool.name,
      input,
      value: result.ok ? result.value : null,
    })
    return result
  },
})

// createMeshiDomainAgent only ever calls registry.list(); wrapping just that
// method is enough to observe every domain tool call this agent turn makes.
// executeToolUse is intentionally left unable to fall through to the
// unwrapped registry: any future caller of it would silently bypass
// recording, so it fails loudly instead (mirrors the stub registries in
// this file's own tests).
const wrapRegistryForRecording = (
  registry: DomainToolsRegistry,
  invocations: RecordedInvocation[],
): DomainToolsRegistry => {
  const wrapped = registry.list().map((tool) => wrapTool(tool, invocations))
  const byName = new Map<string, DomainTool>(
    wrapped.map((tool) => [tool.name, tool]),
  )
  return {
    list: () => wrapped,
    get: (name) => byName.get(name),
    toLlmSchemas: () => registry.toLlmSchemas(),
    executeToolUse: () => {
      throw new Error(
        'executeToolUse is not observed by wrapRegistryForRecording; createMeshiDomainAgent must not call it',
      )
    },
  }
}

const extractFoodMasterId = (input: unknown): string => {
  if (input === null || typeof input !== 'object') return ''
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- input came from the LLM; we already narrowed to a non-null object and only read one string field.
  const raw = (input as Readonly<Record<string, unknown>>)['food_master_id']
  return typeof raw === 'string' ? raw : ''
}

const collectRecorded = (
  invocations: ReadonlyArray<RecordedInvocation>,
): ReadonlyArray<RecordedMeal> => {
  const out: RecordedMeal[] = []
  for (const inv of invocations) {
    if (inv.name !== 'record_meal_log' || inv.value === null) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- value is the return value of createRecordMealLogTool.execute, whose type is RecordMealLogOutput.
    const value = inv.value as RecordMealLogOutput
    out.push({
      mealLogId: value.meal_log_id,
      foodMasterId: extractFoodMasterId(inv.input),
      nutrition: value.nutrition,
      isEstimated: value.is_estimated,
    })
  }
  return out
}

const findLastInvocationValue = (
  invocations: ReadonlyArray<RecordedInvocation>,
  name: string,
): unknown =>
  invocations.findLast((inv) => inv.name === name && inv.value !== null)
    ?.value ?? null

const collectLastSearchCandidates = (
  invocations: ReadonlyArray<RecordedInvocation>,
): ReadonlyArray<FoodCandidate> => {
  const value = findLastInvocationValue(invocations, 'search_food_master')
  if (value === null) return []
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- value is the return value of createSearchFoodMasterTool.execute.
  return (value as SearchFoodMasterOutput).candidates.map((c) => ({
    foodMasterId: c.food_master_id,
    compositionCode: c.composition_code,
    name: c.name,
    isEstimated: c.is_estimated,
    score: c.score,
    reason: c.reason,
  }))
}

const collectLastAggregate = (
  invocations: ReadonlyArray<RecordedInvocation>,
): MealHistoryAggregateSnapshot | null => {
  const value = findLastInvocationValue(invocations, 'query_meal_history')
  if (value === null) return null
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- value is the return value of createQueryMealHistoryTool.execute.
  const output = value as QueryMealHistoryOutput
  return {
    totals: output.totals,
    perDay: output.per_day.map((d) => ({ date: d.date, totals: d.totals })),
    entries: output.entries.map((entry) => ({
      mealLogId: entry.meal_log_id,
      foodMasterId: entry.food_master_id,
      eatenAtIso: entry.eaten_at_iso,
      quantity: entry.quantity,
      unit: entry.unit,
      note: entry.note,
    })),
    hasEstimatedValues: output.has_estimated_values,
  }
}

// A single agent turn has no per-item boundaries in `invocations` (a multi-
// food utterance runs through one flat tool-call history), so this
// approximates "was the last search's result consumed by a subsequent
// record" rather than tracking it precisely — good enough to keep a
// still-ambiguous item's candidates visible alongside an already-recorded
// one in the same turn.
const recordedAfterLastSearch = (
  invocations: ReadonlyArray<RecordedInvocation>,
): boolean => {
  const lastSearchIndex = invocations.findLastIndex(
    (inv) => inv.name === 'search_food_master',
  )
  if (lastSearchIndex === -1) return false
  return invocations
    .slice(lastSearchIndex)
    .some((inv) => inv.name === 'record_meal_log' && inv.value !== null)
}

// The agent's own reported failure has no equivalent in OrchestratorErrorKind
// (fixed by the MCP wire contract); item_conversation_failed is the closest
// existing bucket for "the internal agent conversation did not produce a
// usable result".
const AGENT_ERROR_KIND = 'item_conversation_failed'
const INVALID_RESPONSE_MESSAGE = 'The agent did not return a valid response.'

const buildAgentError = (
  response: MeshiAgentResponse | null,
): OrchestratorError | null => {
  if (response === null) {
    return { kind: AGENT_ERROR_KIND, message: INVALID_RESPONSE_MESSAGE }
  }
  if (response.status === 'error') {
    return { kind: AGENT_ERROR_KIND, message: response.message }
  }
  return null
}

const formatMeta = (
  occurredAt: Date | undefined,
  timezone: string | undefined,
): string => {
  const parts: string[] = []
  if (occurredAt !== undefined) {
    parts.push(`occurred_at=${occurredAt.toISOString()}`)
  }
  if (timezone !== undefined && timezone !== '') {
    parts.push(`timezone=${timezone}`)
  }
  return parts.length === 0 ? '' : `(meta: ${parts.join(', ')})`
}

const textContent = (
  body: string,
  occurredAt: Date | undefined,
  timezone: string | undefined,
): AgentContentBlock[] => {
  const meta = formatMeta(occurredAt, timezone)
  return [{ type: 'text', text: meta === '' ? body : `${meta}\n${body}` }]
}

export const createDomainAgentOrchestrator = (
  options: DomainAgentOrchestratorOptions,
): ConversationOrchestrator => {
  const formatter = options.formatter ?? createPassthroughReplyFormatter()

  const runTurn = async (
    content: ReadonlyArray<AgentContentBlock>,
  ): Promise<{
    readonly invocations: ReadonlyArray<RecordedInvocation>
    readonly response: MeshiAgentResponse | null
  }> => {
    const invocations: RecordedInvocation[] = []
    const agent = createMeshiDomainAgent({
      model: options.model,
      registry: wrapRegistryForRecording(options.registry, invocations),
      // Each call is a one-shot conversation identified by a fresh thread_id
      // below, never revisited — a real (Postgres-backed) checkpointer would
      // just accumulate unreclaimed rows forever.
      checkpointer: new MemorySaver(),
    })
    // A crashed agent.invoke() (e.g. a transport failure) must not discard
    // invocations already recorded before the crash — a food recorded
    // earlier in the same multi-item turn is a real DB write and belongs in
    // the result even if a later item's tool call blew up.
    const result = await agent
      .invoke(
        { messages: [{ role: 'user', content: [...content] }] },
        { configurable: { thread_id: randomUUID() } },
      )
      .catch((err: unknown) => {
        console.error('meshi: domain agent turn failed', err)
        return null
      })
    const parsed =
      result === null
        ? null
        : meshiAgentResponseSchema.safeParse(result.structuredResponse)
    return {
      invocations,
      response: parsed?.success === true ? parsed.data : null,
    }
  }

  const runRecordTurn = async (
    content: ReadonlyArray<AgentContentBlock>,
  ): Promise<MealRecordResult> => {
    const { invocations, response } = await runTurn(content)
    const recorded = collectRecorded(invocations)
    const candidates = recordedAfterLastSearch(invocations)
      ? []
      : collectLastSearchCandidates(invocations)
    const hasEstimatedValues = recorded.some((r) => r.isEstimated)
    const error = buildAgentError(response)
    const summaryText = formatter.formatMealRecord({
      recorded,
      candidates,
      hasEstimatedValues,
      finalText: response?.message ?? '',
      error,
    })
    return { recorded, candidates, hasEstimatedValues, summaryText, error }
  }

  return {
    recordFromText(input: RecordFromTextInput) {
      return runRecordTurn(
        textContent(input.text, input.occurredAt, input.timezone),
      )
    },
    recordFromImage(input: RecordFromImageInput) {
      const content: AgentContentBlock[] = []
      const meta = formatMeta(input.occurredAt, input.timezone)
      if (meta !== '') content.push({ type: 'text', text: meta })
      if (input.hintText !== undefined && input.hintText !== '') {
        content.push({ type: 'text', text: input.hintText })
      }
      content.push({
        type: 'image',
        mimeType: input.image.mimeType,
        data: input.image.base64,
      })
      return runRecordTurn(content)
    },
    async queryMeals(input: QueryMealsInput): Promise<MealHistoryResult> {
      const body = [
        input.query,
        input.periodFrom !== undefined
          ? `period_from=${input.periodFrom.toISOString()}`
          : null,
        input.periodTo !== undefined
          ? `period_to=${input.periodTo.toISOString()}`
          : null,
      ]
        .filter((s): s is string => s !== null)
        .join('\n')
      const { invocations, response } = await runTurn(
        textContent(body, undefined, input.timezone),
      )
      const aggregate = collectLastAggregate(invocations)
      const error = buildAgentError(response)
      const summaryText = formatter.formatMealHistory({
        aggregate,
        finalText: response?.message ?? '',
        error,
      })
      return {
        aggregate,
        hasEstimatedValues: aggregate?.hasEstimatedValues ?? false,
        summaryText,
        error,
      }
    },
    async recommendMeal(input: RecommendInput): Promise<RecommendResult> {
      const body = input.conditions ?? 'No additional conditions.'
      const { response } = await runTurn(
        textContent(body, undefined, input.timezone),
      )
      const error = buildAgentError(response)
      const summaryText = formatter.formatRecommend({
        finalText: response?.message ?? '',
        error,
      })
      return { summaryText, error }
    },
  }
}
