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
        '登録済み食品を複数の名前候補から検索し、食品名、kcal、栄養状態 (nutrition_status: confirmed / estimated / unknown) を返す。栄養値が不明な食品の kcal は null。origin が homemade の場合のみ食品成分表の候補も返す。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。成分表候補の energy_kcal は 100g あたり。',
      inputSchema: searchFoodsInput,
      outputSchema: searchFoodsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'search_foods' })
      return await foodSearchService
        .search(args.queries, args.limit ?? 10, args.origin ?? 'retail')
        .match(
          (foods) => {
            const payload = {
              foods: foods.map((food) => ({
                food_master_id: food.foodMasterId,
                composition_code: food.compositionCode,
                name: food.name,
                energy_kcal:
                  food.foodMasterId === null
                    ? food.energyKcalPer100g
                    : food.energyKcalPerUnit,
                is_estimated: food.isEstimated,
                nutrition_status: food.nutritionStatus,
              })),
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'search_foods',
              result_count: foods.length,
            })
            const hasCompositionCandidate = foods.some(
              (food) => food.foodMasterId === null,
            )
            return {
              content: [
                {
                  type: 'text' as const,
                  text: hasCompositionCandidate
                    ? `食品候補を ${String(foods.length)} 件取得しました。`
                    : `登録済み食品を ${String(foods.length)} 件取得しました。`,
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
                nutrition_status: item.nutritionStatus,
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
