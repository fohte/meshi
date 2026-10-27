import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { toFoodNutritionVersionPayload } from '#mcp-tools/nutrition-version-payload'
import {
  addFoodNutritionVersionInput,
  addFoodNutritionVersionStructuredOutput,
} from '#mcp-tools/nutrition-version-schemas'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'

const description =
  '同じ food_master_id に栄養バージョンを追加する。change_kind=product_update は商品情報の更新に使い、checked_on を指定する。effective_from は実際の適用開始日が分かる場合だけ指定し、不明なら null を指定する。checked_on は情報を確認した日で、商品変更日を意味しない。change_kind=correction は誤登録の訂正に使い、corrects_version_id と reason を必ず指定する。訂正元が現行なら新バージョンが現行になり、過去バージョンなら現行は変わらない。訂正時に serving_basis、net_content、effective_from を省略すると訂正元の値を引き継ぎ、値を指定すると置き換える。これらを不明にする場合は null を指定する。栄養値は meal_logs.quantity が掛ける食品 1 つ分の値を指定する。出典の基準量が食品 1 つ分と異なる場合は食品 1 つ分へ換算する。source=web_search は is_estimated=false と source_url を指定する。source=composition_table_estimate は is_estimated=true と source_composition_code を指定する。source=user_input はユーザー本人が伝えた値に限り、source_url と source_composition_code は指定しない。source=model_estimate は is_estimated=true とし、出典 URL と composition code は指定しない。serving_basis と net_content は分かる値を記録する。既存の食事ログの数量、食品 ID、栄養バージョンは変更しない。'

export const registerAddFoodNutritionVersionTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps
  server.registerTool(
    'add_food_nutrition_version',
    {
      description,
      inputSchema: addFoodNutritionVersionInput,
      outputSchema: addFoodNutritionVersionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'add_food_nutrition_version' })
      return foodMasterService
        .addNutritionVersion({
          foodMasterId: args.food_master_id,
          changeKind: args.change_kind,
          nutrition: args.nutrition,
          source: args.source,
          isEstimated: args.is_estimated,
          ...(args.source_url === undefined
            ? {}
            : { sourceUrl: args.source_url }),
          ...(args.source_composition_code === undefined
            ? {}
            : { sourceCompositionCode: args.source_composition_code }),
          ...(args.serving_basis === undefined
            ? {}
            : { servingBasis: args.serving_basis }),
          ...(args.net_content === undefined
            ? {}
            : { netContent: args.net_content }),
          ...(args.checked_on === undefined
            ? {}
            : { checkedOn: args.checked_on }),
          ...(args.effective_from === undefined
            ? {}
            : { effectiveFrom: args.effective_from }),
          ...(args.change_kind === 'correction'
            ? {
                correctsVersionId: args.corrects_version_id,
                reason: args.reason,
              }
            : {}),
        })
        .match(
          (version) => {
            const payload = toFoodNutritionVersionPayload(version)
            logger.log(TOOL_SUCCEEDED, {
              tool: 'add_food_nutrition_version',
              food_master_id: version.foodMasterId,
              version_no: version.versionNo,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '栄養バージョンを追加しました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'add_food_nutrition_version', error, {
              code: `food_master/${error.code}`,
            }),
        )
    },
  )
}
