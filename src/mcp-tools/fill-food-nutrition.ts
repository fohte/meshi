import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  fillFoodNutritionInput,
  fillFoodNutritionStructuredOutput,
} from '#mcp-tools/schemas'

const description =
  '栄養値が不明の food_master に栄養値を補完する。food_master_id を指定する。nutrition.energy_kcal は必須。既に栄養値がある食品は補完できない。栄養値を一般知識から作らない。出典はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。'

export const registerFillFoodNutritionTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps

  server.registerTool(
    'fill_food_nutrition',
    {
      description,
      inputSchema: fillFoodNutritionInput,
      outputSchema: fillFoodNutritionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'fill_food_nutrition' })
      return await foodMasterService
        .fillNutrition({
          foodMasterId: args.food_master_id,
          nutrition: args.nutrition,
          source: args.source,
          isEstimated: args.is_estimated,
          ...(args.source_url === undefined
            ? {}
            : { sourceUrl: args.source_url }),
        })
        .match(
          (nutritionStatus) => {
            const payload = {
              food_master_id: args.food_master_id,
              nutrition_status: nutritionStatus,
            }
            logger.log(TOOL_SUCCEEDED, { tool: 'fill_food_nutrition' })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '食品の栄養値を補完しました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) => {
            const code = `food_master/${error.code}`
            return errorResult(logger, 'fill_food_nutrition', error, {
              code,
              structuredContent: {
                error: { code, message: error.message },
              },
            })
          },
        )
    },
  )
}
