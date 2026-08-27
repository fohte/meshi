import { randomUUID } from 'node:crypto'

import { captureWithFingerprint } from '@fohte/service-kit/observability'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { MemorySaver } from '@langchain/langgraph'
import type { AnyAgentMiddleware } from 'langchain'
import { ResultAsync } from 'neverthrow'

import type { LlmToolSchema } from '#adapters/llm/types'
import {
  type AgentContentBlock,
  formatPromptMeta,
  toHumanMessage,
} from '#llm/agent/content-block'
import {
  AGENT_NO_USABLE_REPLY_EVENT,
  AGENT_QUESTION_TEXT_MISSING_EVENT,
  AGENT_THINK_BLOCK_LEAKED_EVENT,
  type AgentReply,
  buildNoUsableReplyError,
  deriveAgentReply,
  NO_USABLE_REPLY_MESSAGE,
} from '#llm/agent/derive-reply'
import {
  createMeshiDomainAgent,
  MESHI_AGENT_RECURSION_LIMIT,
} from '#llm/agent/domain-agent'
import type { DomainToolsRegistry } from '#llm/domain-tools/registry'
import {
  type QueryMealHistoryOutput,
  toMealHistoryEntryFields,
} from '#llm/domain-tools/tools/query-meal-history'
import type { RecordMealLogOutput } from '#llm/domain-tools/tools/record-meal-log'
import type { SearchFoodMasterOutput } from '#llm/domain-tools/tools/search-food-master'
import type { DomainTool, DomainToolName } from '#llm/domain-tools/types'
import {
  createPassthroughReplyFormatter,
  type ReplyFormatter,
} from '#llm/orchestrator/reply-formatter'
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
} from '#llm/orchestrator/types'
import { createNullLogger, type Logger } from '#logger'

export interface DomainAgentOrchestratorOptions {
  readonly model: BaseChatModel
  readonly registry: DomainToolsRegistry
  readonly formatter?: ReplyFormatter
  readonly logger?: Logger
  readonly middleware?: ReadonlyArray<AnyAgentMiddleware>
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
      value: result.isOk() ? result.value : null,
    })
    return result
  },
})

// Shared by every DomainToolsRegistry derivation below: createMeshiDomainAgent
// only ever calls registry.list(), so a derived registry only needs to
// override that (and get(), for stub/test symmetry). executeToolUse is
// intentionally left unable to fall through to the source registry: any
// future caller of it would silently bypass whatever this derivation exists
// to enforce (recording, or restricting to read-only tools), so it fails
// loudly instead (mirrors the stub registries in this file's own tests).
const deriveRegistry = (
  tools: ReadonlyArray<DomainTool>,
  originName: string,
  toLlmSchemas: () => ReadonlyArray<LlmToolSchema>,
): DomainToolsRegistry => {
  const byName = new Map<string, DomainTool>(tools.map((t) => [t.name, t]))
  return {
    list: () => tools,
    get: (name) => byName.get(name),
    toLlmSchemas,
    executeToolUse: () =>
      Promise.reject(
        new Error(
          `executeToolUse is not observed by ${originName}; createMeshiDomainAgent must not call it`,
        ),
      ),
  }
}

const wrapRegistryForRecording = (
  registry: DomainToolsRegistry,
  invocations: RecordedInvocation[],
): DomainToolsRegistry => {
  const wrapped = registry.list().map((tool) => wrapTool(tool, invocations))
  return deriveRegistry(wrapped, 'wrapRegistryForRecording', () =>
    registry.toLlmSchemas(),
  )
}

// query_meals / recommend_meal declare readOnlyHint: true on their MCP tool
// (see src/mcp-tools.ts), so the agent turn behind them must never be able
// to reach a write tool — not even via a prompt-injected instruction in the
// free-text query. createMeshiDomainAgent only calls registry.list(), so
// filtering it here is enough (see deriveRegistry above).
const READ_ONLY_TOOL_NAMES: ReadonlySet<DomainToolName> = new Set([
  'search_food_master',
  'query_meal_history',
  'get_user_profile',
  'web_search',
])

export const restrictToReadOnly = (
  registry: DomainToolsRegistry,
): DomainToolsRegistry => {
  const tools = registry
    .list()
    .filter((tool) => READ_ONLY_TOOL_NAMES.has(tool.name))
  return deriveRegistry(tools, 'restrictToReadOnly', () =>
    tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  )
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
      ...toMealHistoryEntryFields(entry),
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

// A domain agent turn that produced no usable reply has no equivalent in
// OrchestratorErrorKind (fixed by the MCP wire contract);
// item_conversation_failed is the closest existing bucket for "the internal
// agent conversation did not produce a usable result".
const AGENT_ERROR_KIND = 'item_conversation_failed'

const AGENT_INVOKE_FAILED_PREFIX = 'meshi: domain agent turn failed:'
const ORCHESTRATOR_INVOKE_FAILED_FINGERPRINT =
  'llm.orchestrator.agent-invoke-failed'
const ORCHESTRATOR_NO_USABLE_REPLY_FINGERPRINT =
  'llm.orchestrator.no-usable-reply'

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e)

const textContent = (
  body: string,
  occurredAt: Date | undefined,
  timezone: string | undefined,
): AgentContentBlock[] => {
  const meta = formatPromptMeta(occurredAt, timezone)
  return [{ type: 'text', text: meta === '' ? body : `${meta}\n${body}` }]
}

export const createDomainAgentOrchestrator = (
  options: DomainAgentOrchestratorOptions,
): ConversationOrchestrator => {
  const formatter = options.formatter ?? createPassthroughReplyFormatter()
  const logger = options.logger ?? createNullLogger()

  const runTurn = async (
    content: ReadonlyArray<AgentContentBlock>,
    registry: DomainToolsRegistry = options.registry,
  ): Promise<{
    readonly invocations: ReadonlyArray<RecordedInvocation>
    readonly reply: AgentReply | null
    readonly error: OrchestratorError | null
  }> => {
    const invocations: RecordedInvocation[] = []
    const agent = createMeshiDomainAgent({
      model: options.model,
      registry: wrapRegistryForRecording(registry, invocations),
      // Each call is a one-shot conversation identified by a fresh thread_id
      // below, never revisited — a real (Postgres-backed) checkpointer would
      // just accumulate unreclaimed rows forever.
      checkpointer: new MemorySaver(),
      middleware: options.middleware,
    })
    // A crashed agent.invoke() (e.g. a transport failure) must not discard
    // invocations already recorded before the crash — a food recorded
    // earlier in the same multi-item turn is a real DB write and belongs in
    // the result even if a later item's tool call blew up.
    const invokeResult = await ResultAsync.fromPromise(
      agent.invoke(
        { messages: [toHumanMessage(content)] },
        {
          configurable: { thread_id: randomUUID() },
          recursionLimit: MESHI_AGENT_RECURSION_LIMIT,
        },
      ),
      (cause) => cause,
    )
    return invokeResult.match(
      (result) => {
        const reply = deriveAgentReply(
          result.messages,
          () => {
            logger.log(AGENT_THINK_BLOCK_LEAKED_EVENT, {})
          },
          () => {
            logger.log(AGENT_QUESTION_TEXT_MISSING_EVENT, {})
          },
        )
        if (reply === null) {
          logger.log(AGENT_NO_USABLE_REPLY_EVENT, {})
          captureWithFingerprint(
            buildNoUsableReplyError(),
            ORCHESTRATOR_NO_USABLE_REPLY_FINGERPRINT,
          )
          return {
            invocations,
            reply: null,
            error: {
              kind: AGENT_ERROR_KIND,
              message: NO_USABLE_REPLY_MESSAGE,
            },
          }
        }
        return { invocations, reply, error: null }
      },
      (cause) => {
        captureWithFingerprint(cause, ORCHESTRATOR_INVOKE_FAILED_FINGERPRINT)
        return {
          invocations,
          reply: null,
          error: {
            kind: AGENT_ERROR_KIND,
            message: `${AGENT_INVOKE_FAILED_PREFIX} ${errorMessage(cause)}`,
          },
        }
      },
    )
  }

  const runRecordTurn = async (
    content: ReadonlyArray<AgentContentBlock>,
  ): Promise<MealRecordResult> => {
    const { invocations, reply, error } = await runTurn(content)
    const recorded = collectRecorded(invocations)
    const candidates = recordedAfterLastSearch(invocations)
      ? []
      : collectLastSearchCandidates(invocations)
    const hasEstimatedValues = recorded.some((r) => r.isEstimated)
    const summaryText = formatter.formatMealRecord({
      recorded,
      candidates,
      hasEstimatedValues,
      finalText: reply?.text ?? '',
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
      const meta = formatPromptMeta(input.occurredAt, input.timezone)
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
      const { invocations, reply, error } = await runTurn(
        textContent(body, undefined, input.timezone),
        restrictToReadOnly(options.registry),
      )
      const aggregate = collectLastAggregate(invocations)
      const summaryText = formatter.formatMealHistory({
        aggregate,
        finalText: reply?.text ?? '',
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
      const { reply, error } = await runTurn(
        textContent(body, undefined, input.timezone),
        restrictToReadOnly(options.registry),
      )
      const summaryText = formatter.formatRecommend({
        finalText: reply?.text ?? '',
        error,
      })
      return { summaryText, error }
    },
  }
}
