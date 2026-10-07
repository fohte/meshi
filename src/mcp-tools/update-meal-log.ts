import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import { updateMealLogInputSchema } from '#domain/meal-log/update-meal-log-input-schema'
import type { Logger } from '#logger'
import {
  buildMealLogMutationPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import { updateMealLogStructuredOutput } from '#mcp-tools/schemas'

export const registerUpdateMealLogTool = (
  server: McpServer,
  deps: {
    readonly mealLogService: MealLogService
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  server.registerTool(
    'update_meal_log',
    {
      description:
        'query_meals の meal_log_id で指定した食事ログを部分更新する。food_master_id、date、meal_type、quantity のうち 1 つ以上を指定する。',
      inputSchema: updateMealLogInputSchema,
      outputSchema: updateMealLogStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      const { foodMasterService, logger, mealLogService } = deps
      logger.log(TOOL_CALLED, { tool: 'update_meal_log' })

      const run = async () => {
        const result = await mealLogService.update({
          id: args.meal_log_id,
          ...(args.food_master_id === undefined
            ? {}
            : { foodMasterId: args.food_master_id }),
          ...(args.date === undefined ? {} : { eatenDate: args.date }),
          ...(args.meal_type === undefined ? {} : { mealType: args.meal_type }),
          ...(args.quantity === undefined ? {} : { quantity: args.quantity }),
        })
        if (result.isErr()) {
          return errorResult(logger, 'update_meal_log', result.error)
        }

        const foodResult = await foodMasterService.getById(
          result.value.foodMasterId,
        )
        if (foodResult.isErr()) {
          return errorResult(logger, 'update_meal_log', foodResult.error)
        }
        const food = foodResult.value
        if (food === null) {
          return errorResult(
            logger,
            'update_meal_log',
            new FoodMasterDomainError(
              'food_master_not_found',
              `food_master not found: ${result.value.foodMasterId}`,
            ),
          )
        }

        const mealLog = result.value
        logger.log(TOOL_SUCCEEDED, { tool: 'update_meal_log' })
        return {
          content: [
            { type: 'text' as const, text: '食事ログを更新しました。' },
          ],
          structuredContent: {
            ...buildMealLogMutationPayload({ ...mealLog, foodName: food.name }),
            nutrition: mealLog.nutrition,
            is_estimated: mealLog.isEstimated,
          },
        }
      }

      return ResultAsync.fromPromise(
        Promise.resolve().then(run),
        (err) => err,
      ).match(
        (result) => result,
        (err) => errorResult(logger, 'update_meal_log', err),
      )
    },
  )
}
