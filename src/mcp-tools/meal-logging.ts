import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import { MealLogItemValidationError } from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  recordMealLogInput,
  recordMealLogStructuredOutput,
  searchFoodsInput,
  searchFoodsStructuredOutput,
} from '#mcp-tools/schemas'

export interface MealLoggingToolDeps {
  readonly foodSearchService: FoodSearchService
  readonly mealLogService: MealLogService
  readonly logger: Logger
}

export const registerMealLoggingTools = (
  server: McpServer,
  deps: MealLoggingToolDeps,
): void => {
  const { foodSearchService, mealLogService, logger } = deps

  server.registerTool(
    'search_foods',
    {
      description:
        '登録済み食品を複数の名前候補から検索し、1 つ分の kcal と推定値かどうかを返す。',
      inputSchema: searchFoodsInput,
      outputSchema: searchFoodsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'search_foods' })
      return await foodSearchService
        .searchRegistered(args.queries, args.limit ?? 10)
        .match(
          (foods) => {
            const payload = {
              foods: foods.map((food) => ({
                food_master_id: food.foodMasterId,
                name: food.name,
                energy_kcal: food.energyKcalPerUnit,
                is_estimated: food.isEstimated,
              })),
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'search_foods',
              result_count: foods.length,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `登録済み食品を ${String(foods.length)} 件取得しました。`,
                },
              ],
              structuredContent: payload,
            }
          },
          (error) => errorResult(logger, 'search_foods', error),
        )
    },
  )

  server.registerTool(
    'record_meal_log',
    {
      description:
        '食品 ID と量が確定した食事を内部 LLM なしで記録する。quantity は食品 1 つ分への倍率。1 品目でも不正なら何も保存しない。',
      inputSchema: recordMealLogInput,
      outputSchema: recordMealLogStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'record_meal_log' })
      return await mealLogService
        .recordMany({
          eatenDate: args.date,
          mealType: args.meal_type,
          items: args.items.map((item) => ({
            foodMasterId: item.food_master_id,
            foodName: item.food_name,
            quantity: item.quantity,
          })),
        })
        .match(
          (recorded) => {
            const payload = {
              recorded: recorded.map((item) => ({
                meal_log_id: item.id,
                food_master_id: item.foodMasterId,
                food_name: item.foodName,
                quantity: item.quantity,
                nutrition: item.nutrition,
                is_estimated: item.isEstimated,
              })),
              error: null,
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'record_meal_log',
              recorded_count: recorded.length,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `${String(recorded.length)} 品目を記録しました。`,
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'record_meal_log', error, {
              code: error.code,
              structuredContent: {
                recorded: [],
                error: {
                  item_index:
                    error instanceof MealLogItemValidationError
                      ? error.itemIndex
                      : null,
                  code: error.code,
                  message: error.message,
                },
              },
            }),
        )
    },
  )
}
