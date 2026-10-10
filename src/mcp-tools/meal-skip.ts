import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  cancelMealSkipInput,
  cancelMealSkipStructuredOutput,
  recordMealSkipInput,
  recordMealSkipStructuredOutput,
} from '#mcp-tools/schemas'

export const registerMealSkipTools = (
  server: McpServer,
  deps: {
    readonly mealSkipService: MealSkipService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'record_meal_skip',
    {
      description:
        'ユーザーが特定の日の特定の食事を抜いたと明言した場合だけ記録する。食事ログがないことだけを理由に記録しない。date は JST の YYYY-MM-DD、meal_type は breakfast / lunch / dinner / snack。',
      inputSchema: recordMealSkipInput,
      outputSchema: recordMealSkipStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const { logger, mealSkipService } = deps
      logger.log(TOOL_CALLED, { tool: 'record_meal_skip' })

      const run = async () => {
        const result = await mealSkipService.record({
          date: args.date,
          mealType: args.meal_type,
        })
        if (result.isErr()) {
          return errorResult(logger, 'record_meal_skip', result.error)
        }

        const recorded = {
          meal_skip_id: result.value.id,
          date: result.value.date,
          meal_type: result.value.mealType,
        }
        logger.log(TOOL_SUCCEEDED, { tool: 'record_meal_skip' })
        return {
          content: [
            { type: 'text' as const, text: '食事スキップを記録しました。' },
          ],
          structuredContent: recorded,
        }
      }

      return ResultAsync.fromPromise(
        Promise.resolve().then(run),
        (err) => err,
      ).match(
        (result) => result,
        (err) => errorResult(logger, 'record_meal_skip', err),
      )
    },
  )

  server.registerTool(
    'cancel_meal_skip',
    {
      description:
        '以前に記録した食事スキップを取り消す。ユーザーがその食事を抜いていないと伝えた場合に使う。対象が存在しない場合はエラーになる。',
      inputSchema: cancelMealSkipInput,
      outputSchema: cancelMealSkipStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      const { logger, mealSkipService } = deps
      logger.log(TOOL_CALLED, { tool: 'cancel_meal_skip' })

      const run = async () => {
        const result = await mealSkipService.cancel({
          date: args.date,
          mealType: args.meal_type,
        })
        if (result.isErr()) {
          return errorResult(logger, 'cancel_meal_skip', result.error)
        }

        const canceled = { date: args.date, meal_type: args.meal_type }
        logger.log(TOOL_SUCCEEDED, { tool: 'cancel_meal_skip' })
        return {
          content: [
            { type: 'text' as const, text: '食事スキップを取り消しました。' },
          ],
          structuredContent: canceled,
        }
      }

      return ResultAsync.fromPromise(
        Promise.resolve().then(run),
        (err) => err,
      ).match(
        (result) => result,
        (err) => errorResult(logger, 'cancel_meal_skip', err),
      )
    },
  )
}
