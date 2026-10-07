import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import { MealLogNotFoundError } from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult } from '#domain/meal-log/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  deleteMealLogInput,
  deleteMealLogStructuredOutput,
} from '#mcp-tools/schemas'

export const registerDeleteMealLogTool = (
  server: McpServer,
  deps: {
    readonly mealLogService: MealLogService
    readonly foodMasterService: FoodMasterService
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
      const { foodMasterService, logger, mealLogService } = deps
      logger.log(TOOL_CALLED, { tool: 'delete_meal_log' })

      const run = async () => {
        const foundResults = await Promise.all(
          args.meal_log_ids.map(async (id) => ({
            id,
            result: await mealLogService.getById(id),
          })),
        )
        const records: MealLogResult[] = []
        for (const { id, result } of foundResults) {
          if (result.isErr()) {
            return errorResult(logger, 'delete_meal_log', result.error)
          }
          const record = result.value
          if (record === null) {
            return errorResult(
              logger,
              'delete_meal_log',
              new MealLogNotFoundError(id),
            )
          }
          records.push(record)
        }

        const foodResults = await Promise.all(
          records.map(async (record) => ({
            record,
            result: await foodMasterService.getById(record.foodMasterId),
          })),
        )
        const deleted = []
        for (const { record, result } of foodResults) {
          if (result.isErr()) {
            return errorResult(logger, 'delete_meal_log', result.error)
          }
          const food = result.value
          if (food === null) {
            return errorResult(
              logger,
              'delete_meal_log',
              new FoodMasterDomainError(
                'food_master_not_found',
                `food_master not found: ${record.foodMasterId}`,
              ),
            )
          }
          deleted.push({
            meal_log_id: record.id,
            food_master_id: record.foodMasterId,
            food_name: food.name,
            eaten_date: record.eatenDate,
            meal_type: record.mealType,
            quantity: record.quantity,
          })
        }

        for (const record of records) {
          const result = await mealLogService.delete(record.id)
          if (result.isErr()) {
            return errorResult(logger, 'delete_meal_log', result.error)
          }
        }

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
