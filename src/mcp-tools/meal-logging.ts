import type { McpServer } from '@modelcontextprotocol/server'
import { ResultAsync } from 'neverthrow'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import { MealLogItemValidationError } from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealSetService } from '#domain/meal-set/meal-set-service'
import type { Logger } from '#logger'
import {
  buildMealSetPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  recordMealLogInput,
  recordMealLogStructuredOutput,
  searchFoodsInput,
  searchFoodsStructuredOutput,
} from '#mcp-tools/schemas'

export interface MealLoggingToolDeps {
  readonly foodSearchService: FoodSearchService
  readonly mealSetService: MealSetService
  readonly mealLogService: MealLogService
  readonly logger: Logger
}

export const registerMealLoggingTools = (
  server: McpServer,
  deps: MealLoggingToolDeps,
): void => {
  const { foodSearchService, mealSetService, mealLogService, logger } = deps

  server.registerTool(
    'search_foods',
    {
      description:
        '登録済み食品を複数の名前候補から検索し、食品名、kcal、栄養状態 (nutrition_status: confirmed / estimated / unknown)、最後に食べた JST 日付 (last_eaten_date) とそのときの量 (last_quantity) を返す。栄養値が不明な食品の kcal は null。last_eaten_date がある候補と同じ食品なら新規登録せず、その food_master_id を使う。量の指定が無ければ last_quantity を使い、null ならユーザーに量を聞く。origin が homemade の場合のみ食品成分表の候補も返す。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。成分表候補の energy_kcal は 100g あたり。meal_sets に一致があれば items を record_meal_log に渡す。ユーザーが品目を指定した場合は該当 item だけ差し替える。meal_type は発話から決め、無ければユーザーに聞く。',
      inputSchema: searchFoodsInput,
      outputSchema: searchFoodsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'search_foods' })
      const foodResults = foodSearchService.search(
        args.queries,
        args.limit ?? 10,
        args.origin ?? 'retail',
      )
      const mealSetResults = ResultAsync.combine(
        args.queries.map((query) => mealSetService.searchByName(query)),
      ).map((mealSetsByQuery) =>
        Array.from(
          new Map(
            mealSetsByQuery
              .flat()
              .map((mealSet) => [mealSet.id, mealSet] as const),
          ).values(),
        ),
      )

      return await ResultAsync.combine([foodResults, mealSetResults]).match(
        ([foods, mealSets]) => {
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
              last_eaten_date: food.lastEatenDate,
              last_quantity: food.lastQuantity,
            })),
            meal_sets: mealSets.map(buildMealSetPayload),
          }
          logger.log(TOOL_SUCCEEDED, {
            tool: 'search_foods',
            result_count: foods.length,
            meal_set_count: mealSets.length,
          })
          const hasCompositionCandidate = foods.some(
            (food) => food.foodMasterId === null,
          )
          return {
            content: [
              {
                type: 'text' as const,
                text: `${hasCompositionCandidate ? '食品候補' : '登録済み食品'}を ${String(foods.length)} 件、マイセットを ${String(mealSets.length)} 件取得しました。`,
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
        '食品 ID と量が確定した食事を記録する。quantity は食品 1 つ分への倍率。1 品目でも不正なら何も保存しない。',
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
