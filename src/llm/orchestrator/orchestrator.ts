import { z } from 'zod'

import {
  interpretImage as defaultInterpretImage,
  type InterpretImageInput,
  type SupportedImageMimeType,
  type VisionContentBlock,
} from '@/adapters/image/image-interpreter'
import type {
  LlmClient,
  LlmContent,
  LlmMessage,
  LlmStopReason,
  LlmToolCall,
  LlmToolExecutionResult,
} from '@/adapters/llm/types'
import type { DomainToolsRegistry } from '@/llm/domain-tools/registry'
import type {
  QueryMealHistoryEntry,
  QueryMealHistoryOutput,
} from '@/llm/domain-tools/tools/query-meal-history'
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

export type InterpretImageFn = (
  input: InterpretImageInput,
) => Promise<ReadonlyArray<VisionContentBlock>>

export interface ConversationOrchestratorOptions {
  readonly llmClient: LlmClient
  readonly registry: DomainToolsRegistry
  readonly textModel: string
  readonly visionModel: string
  readonly lightweightModel: string
  readonly maxTurns: number
  readonly formatter?: ReplyFormatter
  readonly interpretImage?: InterpretImageFn
}

interface RecordedToolInvocation {
  readonly name: string
  readonly input: unknown
  readonly executionResult: LlmToolExecutionResult
  // null when the tool was unknown, the call was rejected for divergence, or
  // the domain tool returned an error.
  readonly structured: unknown
}

interface ConversationRunResult {
  readonly finalText: string
  readonly stopReason: LlmStopReason
  readonly invocations: ReadonlyArray<RecordedToolInvocation>
  readonly turns: number
  readonly diverged: boolean
}

// recordFromText runs one conversation per item concurrently; a rejected
// promise (network/transport failure) is captured as 'crashed' instead of
// being allowed to reject the whole Promise.all, which would otherwise
// discard every other item's already-recorded meals.
type ItemOutcome =
  | { readonly kind: 'run'; readonly run: ConversationRunResult }
  | { readonly kind: 'crashed' }

const TEXT_RECORD_SYSTEM = [
  'You are the meshi internal LLM agent that records a meal log from a natural language utterance.',
  'Use the search_food_master tool to locate the food. If nothing matches, use web_search and register_food_master to add it, then call record_meal_log.',
  'Each tool call must use a meaningfully different input from the previous one. Never repeat the same tool with the same arguments back-to-back.',
  'When you have nothing useful left to do, stop calling tools and return a short confirmation as the assistant text.',
  "If you cannot identify the food with confidence, do not call record_meal_log; instead, return assistant text explaining what's missing.",
].join('\n')

const IMAGE_RECORD_SYSTEM = [
  'You are the meshi internal LLM vision agent that records a meal log from a photo (and optional hint text).',
  'Identify the food(s) shown, search the food_master with search_food_master, register missing entries via register_food_master, then call record_meal_log.',
  'Each tool call must use a meaningfully different input from the previous one.',
  'If the photo cannot be interpreted, do not call record_meal_log; return short assistant text describing what is unclear.',
].join('\n')

const QUERY_SYSTEM = [
  'You are the meshi internal LLM agent that aggregates meal history.',
  'Translate the user query into a single query_meal_history call (use search_food_master only if a food filter is needed).',
  'Each tool call must use a meaningfully different input from the previous one.',
  'After receiving the aggregate, stop calling tools and return a short summary as the assistant text.',
].join('\n')

const RECOMMEND_SYSTEM = [
  'You are the meshi internal LLM agent that recommends a meal.',
  'Use get_user_profile and query_meal_history as needed, then return your recommendation as the assistant text without calling further tools.',
  'Each tool call must use a meaningfully different input from the previous one.',
].join('\n')

const ITEM_SPLIT_SYSTEM = [
  'You split a natural-language meal utterance into one entry per distinct food item.',
  "Keep each item's original wording (quantity, brand, description) verbatim; do not translate, summarize, merge, or invent items.",
  'Reply with only a JSON array of strings and nothing else: no markdown, no code fences, no explanation.',
  'If the utterance describes a single food item, reply with a JSON array containing exactly that one string.',
].join('\n')

const canonicalJson = (value: unknown): string => {
  const visit = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(visit)
    if (v !== null && typeof v === 'object') {
      const entries = Object.entries(v).sort(([a], [b]) =>
        a < b ? -1 : a > b ? 1 : 0,
      )
      const out: Record<string, unknown> = {}
      for (const [k, val] of entries) out[k] = visit(val)
      return out
    }
    return v
  }
  return JSON.stringify(visit(value))
}

const safeStringify = (value: unknown): string => {
  try {
    return JSON.stringify(value)
  } catch {
    return JSON.stringify({
      error: { code: 'internal_error', message: 'failed to serialize result' },
    })
  }
}

const encodeOk = (value: unknown): LlmToolExecutionResult => ({
  content: safeStringify(value),
})

const encodeToolError = (
  code: string,
  message: string,
): LlmToolExecutionResult => ({
  content: safeStringify({ error: { code, message } }),
  isError: true,
})

const DIVERGENCE_TOOL_MESSAGE =
  'Divergence detected: you called the same tool with the same arguments twice in a row. Stop calling tools and return your final answer.'

const buildExecutor = (
  tools: ReadonlyMap<string, DomainTool>,
  invocations: RecordedToolInvocation[],
  state: { diverged: boolean; lastKey: string | null },
) => {
  const recordAndReturn = (
    call: LlmToolCall,
    execResult: LlmToolExecutionResult,
    structured: unknown,
  ): LlmToolExecutionResult => {
    invocations.push({
      name: call.name,
      input: call.input,
      executionResult: execResult,
      structured,
    })
    return execResult
  }

  return async (call: LlmToolCall): Promise<LlmToolExecutionResult> => {
    // Once divergence is set, refuse every subsequent call so an LLM that
    // ignores the divergence error and pivots to a different tool does not
    // get to run side-effectful tools (record_meal_log, register_food_master).
    if (state.diverged) {
      return recordAndReturn(
        call,
        encodeToolError('divergence_detected', DIVERGENCE_TOOL_MESSAGE),
        null,
      )
    }
    const key = `${call.name}:${canonicalJson(call.input ?? {})}`
    if (state.lastKey !== null && state.lastKey === key) {
      state.diverged = true
      return recordAndReturn(
        call,
        encodeToolError('divergence_detected', DIVERGENCE_TOOL_MESSAGE),
        null,
      )
    }
    state.lastKey = key

    const tool = tools.get(call.name)
    if (tool === undefined) {
      return recordAndReturn(
        call,
        encodeToolError('unknown_tool', `unknown tool: ${call.name}`),
        null,
      )
    }
    try {
      const result = await tool.execute(call.input)
      if (result.ok) {
        return recordAndReturn(call, encodeOk(result.value), result.value)
      }
      return recordAndReturn(
        call,
        encodeToolError(result.error.code, result.error.message),
        null,
      )
    } catch (e) {
      return recordAndReturn(
        call,
        encodeToolError(
          'internal_error',
          e instanceof Error ? e.message : String(e),
        ),
        null,
      )
    }
  }
}

const initialMessages = (
  userContent: ReadonlyArray<LlmContent>,
): LlmMessage[] => [{ role: 'user', content: userContent }]

const itemListSchema = z.array(z.string().min(1)).min(1)

// Lightweight models frequently wrap JSON replies in a markdown code fence
// despite system prompt instructions not to; strip it so JSON.parse doesn't
// throw on well-formed-but-fenced output.
const stripCodeFence = (text: string): string => {
  const trimmed = text.trim()
  const match = /^```(?:json)?\n?([\s\S]*?)\n?```$/.exec(trimmed)
  return match?.[1] ?? trimmed
}

// Splits free text into independent food items so each gets its own bounded
// tool-use conversation; a shared conversation would need turns proportional
// to the item count and could exhaust maxTurns before recording anything.
const splitTextIntoItems = async (
  llmClient: LlmClient,
  model: string,
  text: string,
): Promise<ReadonlyArray<string>> => {
  try {
    const out = await llmClient.runConversation({
      model,
      system: ITEM_SPLIT_SYSTEM,
      messages: initialMessages([{ type: 'text', text }]),
      tools: [],
      maxTurns: 1,
      executeTool: () =>
        Promise.reject(new Error('item splitting must not call tools')),
    })
    const raw: unknown = JSON.parse(stripCodeFence(out.finalText))
    const parsed = itemListSchema.safeParse(raw)
    if (parsed.success) return parsed.data
  } catch (e) {
    // Invalid JSON or a transport failure: fall back to a single item below.
    console.error('meshi: item split failed, treating input as one item', e)
  }
  return [text]
}

const MAX_TURNS_MESSAGE =
  'The internal LLM loop reached the maximum number of turns without finishing.'

const buildOrchestratorError = (
  diverged: boolean,
  stopReason: LlmStopReason,
): OrchestratorError | null => {
  if (diverged) {
    return {
      kind: 'divergence_detected',
      message: DIVERGENCE_TOOL_MESSAGE,
    }
  }
  if (stopReason === 'max_turns') {
    return {
      kind: 'max_turns_exceeded',
      message: MAX_TURNS_MESSAGE,
    }
  }
  return null
}

const buildMealRecordAggregateError = (flags: {
  readonly diverged: boolean
  readonly hitMaxTurns: boolean
  readonly anyCrashed: boolean
}): OrchestratorError | null => {
  if (flags.diverged) {
    return { kind: 'divergence_detected', message: DIVERGENCE_TOOL_MESSAGE }
  }
  if (flags.hitMaxTurns) {
    return { kind: 'max_turns_exceeded', message: MAX_TURNS_MESSAGE }
  }
  if (flags.anyCrashed) {
    return {
      kind: 'item_conversation_failed',
      message: 'One or more item conversations failed unexpectedly.',
    }
  }
  return null
}

const extractFoodMasterId = (input: unknown): string => {
  if (input === null || typeof input !== 'object') return ''
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- input came from the LLM; we already narrowed to a non-null object and only read one string field.
  const raw = (input as Readonly<Record<string, unknown>>)['food_master_id']
  return typeof raw === 'string' ? raw : ''
}

const collectRecorded = (
  invocations: ReadonlyArray<RecordedToolInvocation>,
): ReadonlyArray<RecordedMeal> => {
  const out: RecordedMeal[] = []
  for (const inv of invocations) {
    if (inv.name !== 'record_meal_log' || inv.structured === null) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structured is the value returned by createRecordMealLogTool.execute, whose return type is RecordMealLogOutput.
    const value = inv.structured as unknown as RecordMealLogOutput
    const foodMasterId = extractFoodMasterId(inv.input)
    out.push({
      mealLogId: value.meal_log_id,
      foodMasterId,
      nutrition: value.nutrition,
      isEstimated: value.is_estimated,
    })
  }
  return out
}

const collectLastSearchCandidates = (
  invocations: ReadonlyArray<RecordedToolInvocation>,
): ReadonlyArray<FoodCandidate> => {
  for (let i = invocations.length - 1; i >= 0; i--) {
    const inv = invocations[i]
    if (inv === undefined) continue
    if (inv.name !== 'search_food_master' || inv.structured === null) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structured is the value returned by createSearchFoodMasterTool.execute.
    const value = inv.structured as unknown as SearchFoodMasterOutput
    return value.candidates.map((c) => ({
      foodMasterId: c.food_master_id,
      compositionCode: c.composition_code,
      name: c.name,
      isEstimated: c.is_estimated,
      score: c.score,
      reason: c.reason,
    }))
  }
  return []
}

const collectLastAggregate = (
  invocations: ReadonlyArray<RecordedToolInvocation>,
): MealHistoryAggregateSnapshot | null => {
  for (let i = invocations.length - 1; i >= 0; i--) {
    const inv = invocations[i]
    if (inv === undefined) continue
    if (inv.name !== 'query_meal_history' || inv.structured === null) continue
    // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- structured is the value returned by createQueryMealHistoryTool.execute.
    const value = inv.structured as unknown as QueryMealHistoryOutput
    return {
      totals: value.totals,
      perDay: value.per_day.map((d) => ({ date: d.date, totals: d.totals })),
      entries: value.entries.map((entry: QueryMealHistoryEntry) => ({
        mealLogId: entry.meal_log_id,
        foodMasterId: entry.food_master_id,
        eatenAtIso: entry.eaten_at_iso,
        quantity: entry.quantity,
        unit: entry.unit,
        note: entry.note,
      })),
      hasEstimatedValues: value.has_estimated_values,
    }
  }
  return null
}

const buildImageUserContent = async (
  interpret: InterpretImageFn,
  image: { mimeType: SupportedImageMimeType; base64: string },
  hintText: string | undefined,
  occurredAt: Date | undefined,
  timezone: string | undefined,
): Promise<LlmContent[]> => {
  const blocks = await interpret({
    image,
    ...(hintText === undefined ? {} : { hintText }),
  })
  const out: LlmContent[] = []
  const meta = formatMeta(occurredAt, timezone)
  if (meta !== '') out.push({ type: 'text', text: meta })
  for (const b of blocks) {
    if (b.type === 'text') out.push({ type: 'text', text: b.text })
    else
      out.push({
        type: 'image',
        mimeType: b.source.media_type,
        base64: b.source.data,
      })
  }
  return out
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

const formatTextUserContent = (
  body: string,
  occurredAt: Date | undefined,
  timezone: string | undefined,
): LlmContent[] => {
  const meta = formatMeta(occurredAt, timezone)
  const text = meta === '' ? body : `${meta}\n${body}`
  return [{ type: 'text', text }]
}

export const createConversationOrchestrator = (
  options: ConversationOrchestratorOptions,
): ConversationOrchestrator => {
  const {
    llmClient,
    registry,
    textModel,
    visionModel,
    lightweightModel,
    maxTurns,
  } = options
  const formatter = options.formatter ?? createPassthroughReplyFormatter()
  const interpret: InterpretImageFn =
    options.interpretImage ?? defaultInterpretImage
  const toolMap = new Map<string, DomainTool>(
    registry.list().map((t) => [t.name, t]),
  )
  const tools = registry.toLlmSchemas()

  const runConversation = async (
    model: string,
    system: string,
    userContent: ReadonlyArray<LlmContent>,
  ): Promise<ConversationRunResult> => {
    const invocations: RecordedToolInvocation[] = []
    const state = { diverged: false, lastKey: null as string | null }
    const executeTool = buildExecutor(toolMap, invocations, state)
    const out = await llmClient.runConversation({
      model,
      system,
      messages: initialMessages(userContent),
      tools,
      maxTurns,
      executeTool,
    })
    return {
      finalText: out.finalText,
      stopReason: out.stopReason,
      invocations,
      turns: out.turns,
      diverged: state.diverged,
    }
  }

  const buildMealRecordResult = (
    outcomes: ReadonlyArray<ItemOutcome>,
  ): MealRecordResult => {
    const recorded: RecordedMeal[] = []
    const candidates: FoodCandidate[] = []
    const finalTexts: string[] = []
    const unresolvedNotes: string[] = []
    let diverged = false
    let hitMaxTurns = false
    let anyCrashed = false
    for (const outcome of outcomes) {
      if (outcome.kind === 'crashed') {
        anyCrashed = true
        continue
      }
      const run = outcome.run
      const runRecorded = collectRecorded(run.invocations)
      recorded.push(...runRecorded)
      const trimmedFinalText = run.finalText.trim()
      if (trimmedFinalText !== '') finalTexts.push(trimmedFinalText)
      if (runRecorded.length === 0) {
        const runCandidates = collectLastSearchCandidates(run.invocations)
        candidates.push(...runCandidates)
        if (runCandidates.length === 0 && trimmedFinalText !== '') {
          unresolvedNotes.push(trimmedFinalText)
        }
      }
      if (run.diverged) diverged = true
      if (run.stopReason === 'max_turns') hitMaxTurns = true
    }
    const hasEstimatedValues = recorded.some((r) => r.isEstimated)
    // A per-item failure (max_turns/divergence/crash) only becomes a
    // top-level error when no item produced anything usable; otherwise the
    // items that did succeed would be hidden behind an error the formatter
    // treats as fatal (see formatMealRecordTemplate's early return on `error`).
    const error =
      recorded.length === 0 && candidates.length === 0
        ? buildMealRecordAggregateError({ diverged, hitMaxTurns, anyCrashed })
        : null
    const summaryText = formatter.formatMealRecord({
      recorded,
      candidates,
      hasEstimatedValues,
      finalText: finalTexts.join('\n'),
      unresolvedNotes,
      error,
    })
    return {
      recorded,
      candidates,
      hasEstimatedValues,
      summaryText,
      error,
    }
  }

  return {
    async recordFromText(input: RecordFromTextInput) {
      const items = await splitTextIntoItems(
        llmClient,
        lightweightModel,
        input.text,
      )
      const settled = await Promise.allSettled(
        items.map((item) => {
          const userContent = formatTextUserContent(
            item,
            input.occurredAt,
            input.timezone,
          )
          return runConversation(textModel, TEXT_RECORD_SYSTEM, userContent)
        }),
      )
      const outcomes: ItemOutcome[] = settled.map((settledItem) => {
        if (settledItem.status === 'fulfilled') {
          return { kind: 'run', run: settledItem.value }
        }
        console.error(
          'meshi: an item conversation failed, other items are unaffected',
          settledItem.reason,
        )
        return { kind: 'crashed' }
      })
      return buildMealRecordResult(outcomes)
    },
    async recordFromImage(input: RecordFromImageInput) {
      let userContent: ReadonlyArray<LlmContent>
      try {
        userContent = await buildImageUserContent(
          interpret,
          input.image,
          input.hintText,
          input.occurredAt,
          input.timezone,
        )
      } catch (e) {
        const error: OrchestratorError = {
          kind: 'interpretation_failed',
          message: e instanceof Error ? e.message : String(e),
        }
        const summaryText = formatter.formatMealRecord({
          recorded: [],
          candidates: [],
          hasEstimatedValues: false,
          finalText: '',
          error,
        })
        return {
          recorded: [],
          candidates: [],
          hasEstimatedValues: false,
          summaryText,
          error,
        }
      }
      const run = await runConversation(
        visionModel,
        IMAGE_RECORD_SYSTEM,
        userContent,
      )
      return buildMealRecordResult([{ kind: 'run', run }])
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
      const userContent = formatTextUserContent(body, undefined, input.timezone)
      const run = await runConversation(textModel, QUERY_SYSTEM, userContent)
      const aggregate = collectLastAggregate(run.invocations)
      const error = buildOrchestratorError(run.diverged, run.stopReason)
      const summaryText = formatter.formatMealHistory({
        aggregate,
        finalText: run.finalText,
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
      const userContent = formatTextUserContent(body, undefined, input.timezone)
      const run = await runConversation(
        textModel,
        RECOMMEND_SYSTEM,
        userContent,
      )
      const error = buildOrchestratorError(run.diverged, run.stopReason)
      const summaryText = formatter.formatRecommend({
        finalText: run.finalText,
        error,
      })
      return { summaryText, error }
    },
  }
}
