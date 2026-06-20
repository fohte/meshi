import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'

import { SUPPORTED_IMAGE_MIME_TYPES } from '@/adapters/image/image-interpreter'
import type { UserProfile } from '@/domain/user-profile/user-profile'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import type {
  ConversationOrchestrator,
  MealHistoryResult,
  MealRecordResult,
  OrchestratorError,
  RecommendResult,
} from '@/llm/orchestrator'
import type { Logger } from '@/logger'

export interface MeshiToolDeps {
  readonly orchestrator: ConversationOrchestrator
  readonly profileService: UserProfileService
  readonly logger: Logger
}

const TOOL_CALLED = 'meshi.tool_called'
const TOOL_SUCCEEDED = 'meshi.tool_succeeded'
const TOOL_FAILED = 'meshi.tool_failed'

const isoDatetime = z.iso.datetime({ offset: true })
// z.number() rejects NaN and Infinity by default in zod v4, so it is safe to
// reuse this schema on the MCP input boundary (update_profile.daily_targets).
const nutritionMap = z.record(z.string().min(1), z.number())

const recordedMealOutput = z.object({
  meal_log_id: z.string(),
  food_master_id: z.string(),
  nutrition: nutritionMap,
  is_estimated: z.boolean(),
})

const foodCandidateOutput = z.object({
  food_master_id: z.string().nullable(),
  composition_code: z.string().nullable(),
  name: z.string(),
  is_estimated: z.boolean(),
  score: z.number(),
  reason: z.string(),
})

const orchestratorErrorOutput = z
  .object({
    kind: z.enum([
      'max_turns_exceeded',
      'divergence_detected',
      'interpretation_failed',
    ]),
    message: z.string(),
  })
  .nullable()

const mealRecordStructuredOutput = {
  recorded: z.array(recordedMealOutput),
  candidates: z.array(foodCandidateOutput),
  has_estimated_values: z.boolean(),
  error: orchestratorErrorOutput,
}

const mealHistoryStructuredOutput = {
  aggregate: z
    .object({
      totals: nutritionMap,
      per_day: z.array(
        z.object({
          date: z.string(),
          totals: nutritionMap,
        }),
      ),
      entries: z.array(
        z.object({
          meal_log_id: z.string(),
          food_master_id: z.string(),
          eaten_at_iso: z.string(),
          quantity: z.number(),
          unit: z.string(),
          note: z.string().nullable(),
        }),
      ),
      has_estimated_values: z.boolean(),
    })
    .nullable(),
  has_estimated_values: z.boolean(),
  error: orchestratorErrorOutput,
}

const recommendStructuredOutput = {
  error: orchestratorErrorOutput,
}

const profileStructuredOutput = {
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  constraints: z.array(z.string()),
  daily_targets: nutritionMap.nullable(),
}

const recordFromTextInput = {
  text: z.string().min(1).describe('利用者の自然言語発話'),
  occurred_at: isoDatetime
    .optional()
    .describe('発話時刻 (未指定なら meshi が現在時刻を使う)'),
  timezone: z
    .string()
    .min(1)
    .optional()
    .describe('IANA timezone (例: Asia/Tokyo)'),
}

const base64Data = z
  .string()
  .min(1)
  .regex(
    /^[A-Za-z0-9+/]+={0,2}$/,
    'image.data must be raw base64 (no data: URL prefix, no http(s):// URL, no whitespace)',
  )
  .describe('base64 (no data: prefix, no URL)')

const imageContentInput = z
  .object({
    type: z.literal('image'),
    mimeType: z.enum([...SUPPORTED_IMAGE_MIME_TYPES]),
    data: base64Data,
  })
  .describe('MCP image content. 外部 URL は受け取らない。')

const recordFromImageInput = {
  image: imageContentInput,
  hint_text: z
    .string()
    .min(1)
    .optional()
    .describe('画像と一緒に渡される補助発話 (任意)'),
  occurred_at: isoDatetime.optional(),
  timezone: z.string().min(1).optional(),
}

const queryMealsInput = {
  query_text: z
    .string()
    .min(1)
    .describe('自然言語クエリ (例: 今週のタンパク質)'),
  period_from_iso: isoDatetime.optional(),
  period_to_iso: isoDatetime.optional(),
  timezone: z.string().min(1).optional(),
}

const recommendMealInput = {
  additional_constraints: z
    .string()
    .min(1)
    .optional()
    .describe('追加条件 (例: 軽め、外食可)'),
  timezone: z.string().min(1).optional(),
}

const updateProfileInput = {
  likes: z.array(z.string().min(1)).optional(),
  dislikes: z.array(z.string().min(1)).optional(),
  allergies: z.array(z.string().min(1)).optional(),
  constraints: z.array(z.string().min(1)).optional(),
  // null clears any previously stored daily_targets; omit to keep them.
  daily_targets: nutritionMap.nullable().optional(),
}

const toErrorSummary = (message: string): string =>
  message.trim() === '' ? 'meshi 内部でエラーが発生しました。' : message.trim()

const errorResult = (
  logger: Logger,
  toolName: string,
  err: unknown,
): CallToolResult => {
  const message = err instanceof Error ? err.message : String(err)
  const code =
    err instanceof Error && err.name !== 'Error' ? err.name : 'internal_error'
  logger.log(TOOL_FAILED, { tool: toolName, code, message })
  // structuredContent omitted: there is no shape that satisfies every tool's
  // outputSchema simultaneously.
  return {
    isError: true,
    content: [{ type: 'text', text: toErrorSummary(message) }],
  }
}

const buildMealRecordPayload = (
  result: MealRecordResult,
): Record<string, unknown> => ({
  recorded: result.recorded.map((r) => ({
    meal_log_id: r.mealLogId,
    food_master_id: r.foodMasterId,
    nutrition: r.nutrition,
    is_estimated: r.isEstimated,
  })),
  candidates: result.candidates.map((c) => ({
    food_master_id: c.foodMasterId,
    composition_code: c.compositionCode,
    name: c.name,
    is_estimated: c.isEstimated,
    score: c.score,
    reason: c.reason,
  })),
  has_estimated_values: result.hasEstimatedValues,
  error: orchestratorErrorPayload(result.error),
})

const buildMealHistoryPayload = (
  result: MealHistoryResult,
): Record<string, unknown> => ({
  aggregate:
    result.aggregate === null
      ? null
      : {
          totals: result.aggregate.totals,
          per_day: result.aggregate.perDay.map((d) => ({
            date: d.date,
            totals: d.totals,
          })),
          entries: result.aggregate.entries.map((e) => ({
            meal_log_id: e.mealLogId,
            food_master_id: e.foodMasterId,
            eaten_at_iso: e.eatenAtIso,
            quantity: e.quantity,
            unit: e.unit,
            note: e.note,
          })),
          has_estimated_values: result.aggregate.hasEstimatedValues,
        },
  has_estimated_values: result.hasEstimatedValues,
  error: orchestratorErrorPayload(result.error),
})

const buildRecommendPayload = (
  result: RecommendResult,
): Record<string, unknown> => ({
  error: orchestratorErrorPayload(result.error),
})

const orchestratorErrorPayload = (
  error: OrchestratorError | null,
): Record<string, unknown> | null =>
  error === null ? null : { kind: error.kind, message: error.message }

const buildProfilePayload = (
  profile: UserProfile,
): Record<string, unknown> => ({
  likes: profile.likes,
  dislikes: profile.dislikes,
  allergies: profile.allergies,
  constraints: profile.constraints,
  daily_targets: profile.dailyTargets ?? null,
})

const logOrchestratorOutcome = (
  logger: Logger,
  toolName: string,
  error: OrchestratorError | null,
  extras: Readonly<Record<string, unknown>>,
): void => {
  if (error === null) {
    logger.log(TOOL_SUCCEEDED, { tool: toolName, ...extras })
    return
  }
  logger.log(TOOL_FAILED, {
    tool: toolName,
    code: error.kind,
    message: error.message,
    ...extras,
  })
}

const orchestratorCallToolResult = (
  summaryText: string,
  payload: Record<string, unknown>,
  error: OrchestratorError | null,
): CallToolResult => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: summaryText }],
    structuredContent: payload,
  }
  if (error !== null) {
    result.isError = true
  }
  return result
}

export const registerMeshiTools = (
  server: McpServer,
  deps: MeshiToolDeps,
): void => {
  const { orchestrator, profileService, logger } = deps

  server.registerTool(
    'record_meal_from_text',
    {
      description:
        'テキスト発話から食事ログを作成する。利用者の発話 + 任意の occurred_at / timezone を受け取り、内部 LLM 経由で食事ログを作成する。',
      inputSchema: recordFromTextInput,
      outputSchema: mealRecordStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'record_meal_from_text' })
      try {
        const result = await orchestrator.recordFromText({
          text: args.text,
          ...(args.occurred_at === undefined
            ? {}
            : { occurredAt: new Date(args.occurred_at) }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
        })
        logOrchestratorOutcome(logger, 'record_meal_from_text', result.error, {
          recorded: result.recorded.length,
          candidates: result.candidates.length,
        })
        return orchestratorCallToolResult(
          result.summaryText,
          buildMealRecordPayload(result),
          result.error,
        )
      } catch (err) {
        return errorResult(logger, 'record_meal_from_text', err)
      }
    },
  )

  server.registerTool(
    'record_meal_from_image',
    {
      description:
        '画像 (MCP image content) + 任意の補助テキストから食事ログを作成する。外部 URL は受け取らず、常に MCP image content (base64) のみを受領する。',
      inputSchema: recordFromImageInput,
      outputSchema: mealRecordStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'record_meal_from_image' })
      try {
        const result = await orchestrator.recordFromImage({
          image: { mimeType: args.image.mimeType, base64: args.image.data },
          ...(args.hint_text === undefined ? {} : { hintText: args.hint_text }),
          ...(args.occurred_at === undefined
            ? {}
            : { occurredAt: new Date(args.occurred_at) }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
        })
        logOrchestratorOutcome(logger, 'record_meal_from_image', result.error, {
          recorded: result.recorded.length,
          candidates: result.candidates.length,
        })
        return orchestratorCallToolResult(
          result.summaryText,
          buildMealRecordPayload(result),
          result.error,
        )
      } catch (err) {
        return errorResult(logger, 'record_meal_from_image', err)
      }
    },
  )

  server.registerTool(
    'query_meals',
    {
      description: '自然言語クエリ (+ 任意の期間) から食事履歴を集計する。',
      inputSchema: queryMealsInput,
      outputSchema: mealHistoryStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'query_meals' })
      try {
        const result = await orchestrator.queryMeals({
          query: args.query_text,
          ...(args.period_from_iso === undefined
            ? {}
            : { periodFrom: new Date(args.period_from_iso) }),
          ...(args.period_to_iso === undefined
            ? {}
            : { periodTo: new Date(args.period_to_iso) }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
        })
        logOrchestratorOutcome(logger, 'query_meals', result.error, {
          has_aggregate: result.aggregate !== null,
        })
        return orchestratorCallToolResult(
          result.summaryText,
          buildMealHistoryPayload(result),
          result.error,
        )
      } catch (err) {
        return errorResult(logger, 'query_meals', err)
      }
    },
  )

  server.registerTool(
    'recommend_meal',
    {
      description:
        '任意の追加条件からプロファイル + 履歴ベースの食事レコメンドを返す。',
      inputSchema: recommendMealInput,
      outputSchema: recommendStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'recommend_meal' })
      try {
        const result = await orchestrator.recommendMeal({
          ...(args.additional_constraints === undefined
            ? {}
            : { conditions: args.additional_constraints }),
          ...(args.timezone === undefined ? {} : { timezone: args.timezone }),
        })
        logOrchestratorOutcome(logger, 'recommend_meal', result.error, {})
        return orchestratorCallToolResult(
          result.summaryText,
          buildRecommendPayload(result),
          result.error,
        )
      } catch (err) {
        return errorResult(logger, 'recommend_meal', err)
      }
    },
  )

  server.registerTool(
    'get_profile',
    {
      description: '現在のプロファイルを返す。',
      inputSchema: {},
      outputSchema: profileStructuredOutput,
    },
    async () => {
      logger.log(TOOL_CALLED, { tool: 'get_profile' })
      try {
        const profile = await profileService.get()
        const payload = buildProfilePayload(profile)
        logger.log(TOOL_SUCCEEDED, { tool: 'get_profile' })
        return {
          content: [{ type: 'text', text: 'プロファイルを取得しました。' }],
          structuredContent: payload,
        }
      } catch (err) {
        return errorResult(logger, 'get_profile', err)
      }
    },
  )

  server.registerTool(
    'update_profile',
    {
      description: 'プロファイル項目の部分更新。',
      inputSchema: updateProfileInput,
      outputSchema: profileStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_profile' })
      try {
        const profile = await profileService.update({
          ...(args.likes === undefined ? {} : { likes: args.likes }),
          ...(args.dislikes === undefined ? {} : { dislikes: args.dislikes }),
          ...(args.allergies === undefined
            ? {}
            : { allergies: args.allergies }),
          ...(args.constraints === undefined
            ? {}
            : { constraints: args.constraints }),
          ...(args.daily_targets === undefined
            ? {}
            : { dailyTargets: args.daily_targets }),
        })
        const payload = buildProfilePayload(profile)
        logger.log(TOOL_SUCCEEDED, { tool: 'update_profile' })
        return {
          content: [{ type: 'text', text: 'プロファイルを更新しました。' }],
          structuredContent: payload,
        }
      } catch (err) {
        return errorResult(logger, 'update_profile', err)
      }
    },
  )
}
