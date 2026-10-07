import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { Logger } from '#logger'
import {
  buildMealLogMutationPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  deleteMealLogInput,
  deleteMealLogStructuredOutput,
} from '#mcp-tools/schemas'

export const registerDeleteMealLogTool = (
  server: McpServer,
  deps: {
    readonly mealLogService: MealLogService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'delete_meal_log',
    {
      description:
        'meal_log_ids で指定した食事ログを削除する。query_meals の meal_log_id を使う。',
      inputSchema: deleteMealLogInput,
      outputSchema: deleteMealLogStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      const { logger, mealLogService } = deps
      logger.log(TOOL_CALLED, { tool: 'delete_meal_log' })

      const run = async () => {
        const result = await mealLogService.deleteMany(args.meal_log_ids)
        if (result.isErr()) {
          return errorResult(logger, 'delete_meal_log', result.error)
        }
        const deleted = result.value.map(buildMealLogMutationPayload)

        logger.log(TOOL_SUCCEEDED, {
          tool: 'delete_meal_log',
          deleted: deleted.length,
        })
        return {
          content: [
            {
              type: 'text' as const,
              text: `${String(deleted.length)} 件の食事ログを削除しました。`,
            },
          ],
          structuredContent: { deleted },
        }
      }

      return ResultAsync.fromPromise(
        Promise.resolve().then(run),
        (err) => err,
      ).match(
        (result) => result,
        (err) => errorResult(logger, 'delete_meal_log', err),
      )
    },
  )
}
