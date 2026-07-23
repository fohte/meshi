import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import type { ConversationOrchestrator } from '@/llm/orchestrator'
import type { Logger } from '@/logger'
import {
  buildMealHistoryPayload,
  buildMealRecordPayload,
  buildProfilePayload,
  buildRecommendPayload,
  errorResult,
  logOrchestratorOutcome,
  orchestratorCallToolResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '@/mcp-tools/payloads'
import {
  mealHistoryStructuredOutput,
  mealRecordStructuredOutput,
  profileStructuredOutput,
  queryMealsInput,
  recommendMealInput,
  recommendStructuredOutput,
  recordFromImageInput,
  recordFromTextInput,
  updateProfileInput,
} from '@/mcp-tools/schemas'

export interface MeshiToolDeps {
  readonly orchestrator: ConversationOrchestrator
  readonly profileService: UserProfileService
  readonly logger: Logger
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
      // Guards a synchronous throw from the .match() callbacks below; profileService itself can no longer reject.
      try {
        return await profileService.get().match(
          (profile) => {
            const payload = buildProfilePayload(profile)
            logger.log(TOOL_SUCCEEDED, { tool: 'get_profile' })
            return {
              content: [
                { type: 'text' as const, text: 'プロファイルを取得しました。' },
              ],
              structuredContent: payload,
            }
          },
          (err) => errorResult(logger, 'get_profile', err),
        )
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
      // Guards a synchronous throw from the .match() callbacks below; profileService itself can no longer reject.
      try {
        return await profileService
          .update({
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
          .match(
            (profile) => {
              const payload = buildProfilePayload(profile)
              logger.log(TOOL_SUCCEEDED, { tool: 'update_profile' })
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'プロファイルを更新しました。',
                  },
                ],
                structuredContent: payload,
              }
            },
            (err) => errorResult(logger, 'update_profile', err),
          )
      } catch (err) {
        return errorResult(logger, 'update_profile', err)
      }
    },
  )
}
