import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { MealHistoryService } from '#domain/meal-history/types'
import type { Logger } from '#logger'
import {
  buildMealHistoryPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  mealHistoryStructuredOutput,
  queryMealsInput,
} from '#mcp-tools/schemas'

export const registerQueryMealsTool = (
  server: McpServer,
  deps: {
    readonly mealHistoryService: MealHistoryService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'query_meals',
    {
      description:
        'JST の period_from 以上、period_to 未満の食事履歴と栄養集計を返す。質問の解釈と集計結果の説明は ChatGPT が行う。後で記録を削除・修正するときは各記録の meal_log_id を使う。',
      inputSchema: queryMealsInput,
      outputSchema: mealHistoryStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const { logger, mealHistoryService } = deps
      logger.log(TOOL_CALLED, { tool: 'query_meals' })
      return ResultAsync.fromPromise(
        Promise.resolve().then(() =>
          mealHistoryService.query({
            periodFrom: args.period_from,
            periodTo: args.period_to,
          }),
        ),
        (err) => err,
      )
        .andThen((result) => result)
        .match(
          (aggregate) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'query_meals' })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '食事履歴を取得しました。',
                },
              ],
              structuredContent: buildMealHistoryPayload(aggregate),
            }
          },
          (err) => errorResult(logger, 'query_meals', err),
        )
    },
  )
}
