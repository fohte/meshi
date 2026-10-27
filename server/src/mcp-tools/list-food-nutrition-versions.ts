import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import {
  listFoodNutritionVersionsInput,
  listFoodNutritionVersionsStructuredOutput,
} from '#mcp-tools/nutrition-version-schemas'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'

export const registerListFoodNutritionVersionsTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps
  server.registerTool(
    'list_food_nutrition_versions',
    {
      description:
        'food_master_id の栄養バージョンを古い順に返す。基準量、内容量、栄養値、出典、推定かどうか、確認日、適用開始日、訂正理由、参照中の食事ログ件数を含む。checked_on と effective_from が null の場合は不明を表す。',
      inputSchema: listFoodNutritionVersionsInput,
      outputSchema: listFoodNutritionVersionsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'list_food_nutrition_versions' })
      return foodMasterService.listNutritionVersions(args.food_master_id).match(
        (versions) => {
          const nutritionVersions = versions.map((version) => ({
            nutrition_version_id: version.id,
            food_master_id: version.foodMasterId,
            version_no: version.versionNo,
            change_kind: version.changeKind,
            corrects_version_id: version.correctsVersionId,
            is_current: version.isCurrent,
            serving_basis: version.servingBasis,
            net_content: version.netContent,
            nutrition: version.nutrition,
            source: version.source,
            source_url: version.sourceUrl,
            source_composition_code: version.sourceCompositionCode,
            is_estimated: version.isEstimated,
            checked_on: version.checkedOn,
            effective_from: version.effectiveFrom,
            reason: version.reason,
            meal_log_count: version.mealLogCount,
          }))
          const payload = {
            food_master_id: args.food_master_id,
            nutrition_versions: nutritionVersions,
          }
          logger.log(TOOL_SUCCEEDED, {
            tool: 'list_food_nutrition_versions',
            food_master_id: args.food_master_id,
            version_count: nutritionVersions.length,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `${String(nutritionVersions.length)} 件の栄養バージョンを取得しました。`,
              },
            ],
            structuredContent: payload,
          }
        },
        (error) =>
          errorResult(logger, 'list_food_nutrition_versions', error, {
            code: `food_master/${error.code}`,
          }),
      )
    },
  )
}
