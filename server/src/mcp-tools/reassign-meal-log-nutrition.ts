import type { McpServer } from '@modelcontextprotocol/server'

import type { MealLogNutritionReassignmentService } from '#domain/meal-log/nutrition-reassignment'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  reassignMealLogNutritionInput,
  reassignMealLogNutritionStructuredOutput,
} from '#mcp-tools/reassign-meal-log-nutrition-schemas'

const description =
  'query_meals で確認した meal_log_id を指定し、選んだ食事ログの栄養バージョンを同じ食品の別バージョンへ差し替える。最初は dry_run=true で実行し、ログごとの前後の栄養値と影響日の合計を確認する。適用するときは dry_run=false とし、プレビューで返した各ログの before_nutrition_version.id を expected_from_versions に渡す。栄養バージョンが未割当だったログは nutrition_version_id=null を渡す。1 件でもプレビュー後にバージョンが変わっていた場合は全件を拒否する。reason は変更記録に保存される。数量、食品 ID、ログ件数は変更しない。'

export const registerReassignMealLogNutritionTool = (
  server: McpServer,
  deps: {
    readonly mealLogNutritionReassignmentService: MealLogNutritionReassignmentService
    readonly logger: Logger
  },
): void => {
  const { mealLogNutritionReassignmentService, logger } = deps

  server.registerTool(
    'reassign_meal_log_nutrition',
    {
      description,
      inputSchema: reassignMealLogNutritionInput,
      outputSchema: reassignMealLogNutritionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'reassign_meal_log_nutrition' })
      return await mealLogNutritionReassignmentService
        .reassign({
          mealLogIds: args.meal_log_ids,
          toNutritionVersionId: args.to_nutrition_version_id,
          reason: args.reason,
          apply: !args.dry_run,
          ...(args.expected_from_versions === undefined
            ? {}
            : {
                expectedFromVersions: args.expected_from_versions.map(
                  (entry) => ({
                    mealLogId: entry.meal_log_id,
                    nutritionVersionId: entry.nutrition_version_id,
                  }),
                ),
              }),
        })
        .match(
          (result) => {
            const payload = {
              dry_run: !result.applied,
              reason: result.reason,
              meal_logs: result.mealLogs.map((mealLog) => ({
                meal_log_id: mealLog.id,
                food_master_id: mealLog.foodMasterId,
                eaten_date: mealLog.eatenDate,
                meal_type: mealLog.mealType,
                quantity: mealLog.quantity,
                before_nutrition_version:
                  mealLog.from === null
                    ? null
                    : {
                        id: mealLog.from.id,
                        version_no: mealLog.from.versionNo,
                        nutrition: mealLog.from.nutrition,
                      },
                after_nutrition_version: {
                  id: mealLog.to.id,
                  version_no: mealLog.to.versionNo,
                  nutrition: mealLog.to.nutrition,
                },
              })),
              affected_day_totals: result.affectedDayTotals.map((day) => ({
                date: day.date,
                totals_before: day.totalsBefore,
                totals_after: day.totalsAfter,
              })),
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'reassign_meal_log_nutrition',
              dry_run: !result.applied,
              meal_log_count: result.mealLogs.length,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: result.applied
                    ? '食事ログの栄養バージョンを差し替えました。'
                    : '栄養バージョンの差し替え内容をプレビューしました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) => {
            const code = error.code
            return errorResult(logger, 'reassign_meal_log_nutrition', error, {
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
