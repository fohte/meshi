import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { MealHistoryService } from '#domain/meal-history/types'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
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
    readonly mealSkipService: MealSkipService
    readonly profileService: UserProfileService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'get_recommendation_context',
    {
      description:
        '指定期間のプロフィール、食事履歴・栄養集計、記録された欠食を返す。meal_skips にある日付・食事区分の食事は摂取量を 0 として扱ってください。食事ログも meal_skips もない食事は未記録なので、食べたか食べていないかを判断しないでください。未記録の食事を含む期間の集計値は下限として読み、確定値として扱わないでください。栄養値の欠損を 0 とみなさず、推定値は推定値として区別してください。過去の栄養の超過や不足を欠食や食べ過ぎで帳尻合わせせず、今後の通常の食事で調整してください。原材料が分からない食品は、アレルギーに当たらないか本人に確かめてから提案・保存してください。提案内容の解釈と文章化は ChatGPT が行います。',
      inputSchema: queryMealsInput,
      outputSchema: recommendationContextStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { logger, mealHistoryService, mealSkipService, profileService } =
        deps
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
      const mealSkips = ResultAsync.fromPromise(
        Promise.resolve().then(() =>
          mealSkipService.findForPeriod(args.period_from, args.period_to),
        ),
        (err) => err,
      ).andThen((result) => result)

      return ResultAsync.combine([profile, history, mealSkips]).match(
        ([profileResult, historyResult, mealSkipRows]) => {
          const loggedMeals = new Set(
            historyResult.entries.map(
              ({ eatenDate, mealType }) => `${eatenDate}:${mealType}`,
            ),
          )
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
              meal_skips: mealSkipRows
                .filter(
                  ({ date, mealType }) =>
                    !loggedMeals.has(`${date}:${mealType}`),
                )
                .map(({ date, mealType }) => ({
                  date,
                  meal_type: mealType,
                })),
            },
          }
        },
        (err) => errorResult(logger, 'get_recommendation_context', err),
      )
    },
  )
}
