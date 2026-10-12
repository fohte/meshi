import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  fillFoodNutritionInput,
  fillFoodNutritionStructuredOutput,
} from '#mcp-tools/schemas'

const description =
  '栄養値が未登録の food_master に栄養値を補完する。food_master_id を指定する。nutrition.energy_kcal は必須。source=model_estimate の栄養値は source=web_search または source=user_input の値で置き換えられる。その他の source がある食品と、source=model_estimate の値を別の推定値で置き換えることはできない。公式情報はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。公式情報もユーザーが伝えた値もない場合は一般的な材料と量から推定してよい。推定値は source=model_estimate と is_estimated=true を指定し、source_url と source_composition_code は指定しない。登録前にユーザーの確認を取らず、登録後に推定値であることを伝える。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。'

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
