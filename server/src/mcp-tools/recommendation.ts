import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { MealHistoryService } from '#domain/meal-history/types'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import type { Logger } from '#logger'
import {
  buildMealHistoryPayload,
  buildProfilePayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  queryMealsInput,
  recommendationContextStructuredOutput,
} from '#mcp-tools/schemas'

export const registerRecommendationContextTool = (
  server: McpServer,
  deps: {
    readonly mealHistoryService: MealHistoryService
    readonly profileService: UserProfileService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'get_recommendation_context',
    {
      description:
        '指定期間のプロフィールと食事履歴・栄養集計をまとめて返す。提案内容の解釈と文章化は ChatGPT が行う。',
      inputSchema: queryMealsInput,
      outputSchema: recommendationContextStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { logger, mealHistoryService, profileService } = deps
      logger.log(TOOL_CALLED, { tool: 'get_recommendation_context' })

      const profile = ResultAsync.fromPromise(
        Promise.resolve().then(() => profileService.get()),
        (err) => err,
      ).andThen((result) => result)
      const history = ResultAsync.fromPromise(
        Promise.resolve().then(() =>
          mealHistoryService.query({
            periodFrom: args.period_from,
            periodTo: args.period_to,
          }),
        ),
        (err) => err,
      ).andThen((result) => result)

      return ResultAsync.combine([profile, history]).match(
        ([profileResult, historyResult]) => {
          logger.log(TOOL_SUCCEEDED, { tool: 'get_recommendation_context' })
          return {
            content: [
              {
                type: 'text' as const,
                text: 'プロフィールと食事履歴を取得しました。',
              },
            ],
            structuredContent: {
              profile: buildProfilePayload(profileResult),
              history: buildMealHistoryPayload(historyResult),
            },
          }
        },
        (err) => errorResult(logger, 'get_recommendation_context', err),
      )
    },
  )
}
