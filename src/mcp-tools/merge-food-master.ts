import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  mergeFoodMasterInput,
  mergeFoodMasterStructuredOutput,
} from '#mcp-tools/schemas'

const description =
  '同じ食品を指す 2 つの食品マスタを統合する。survivor_food_master_id に残す食品、loser_food_master_id に統合する食品を指定する。survivor は、より信頼できる情報が揃っている食品を選ぶ。値が衝突した場合は survivor を優先し、loser の栄養情報はすべて破棄する。loser の別名と食事ログは survivor に移り、loser の名前は同じ文字列の別名が既に存在しない場合に survivor の別名へ加わる。dry_run は既定で true で、変更せずに移動・破棄の内容を返す。試し実行の結果をユーザーに見せて確認を得てから dry_run=false を指定する。実際に統合すると取り消せない。'

export const registerMergeFoodMasterTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps

  server.registerTool(
    'merge_food_master',
    {
      description,
      inputSchema: mergeFoodMasterInput,
      outputSchema: mergeFoodMasterStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'merge_food_master' })
      return await foodMasterService
        .merge(
          args.survivor_food_master_id,
          args.loser_food_master_id,
          args.dry_run,
        )
        .match(
          (result) => {
            const payload = {
              survivor_food_master_id: result.survivorId,
              loser_food_master_id: result.loserId,
              applied: result.applied,
              moved_aliases: result.movedAliases,
              name_moved_as_alias: result.nameMovedAsAlias,
              discarded_nutrition: result.discardedNutrition,
              moved_meal_log_count: result.movedMealLogCount,
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'merge_food_master',
              applied: result.applied,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: result.applied
                    ? '食品マスタを統合しました。'
                    : '食品マスタ統合の試し実行結果です。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'merge_food_master', error, {
              code: `food_master/${error.code}`,
            }),
        )
    },
  )
}
