import type { McpServer } from '@modelcontextprotocol/server'

import type { MealPlanService } from '#domain/meal-plan/meal-plan-service'
import type { MealPlan } from '#domain/meal-plan/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  cancelMealPlanInput,
  cancelMealPlanStructuredOutput,
  listMealPlansInput,
  listMealPlansStructuredOutput,
  saveMealPlanInput,
  saveMealPlanStructuredOutput,
} from '#mcp-tools/schemas'

const toMealPlanPayload = (plan: MealPlan) => ({
  meal_plan_id: plan.id,
  date: plan.date,
  meal_type: plan.mealType,
  items: plan.items.map((item) => ({
    food_master_id: item.foodMasterId,
    food_name: item.foodName,
    quantity: item.quantity,
  })),
  reason: plan.reason,
  status: plan.status,
})

const structuredError = (error: {
  readonly code: string
  readonly message: string
}) => ({
  error: { code: error.code, message: error.message },
})

export const registerMealPlanTools = (
  server: McpServer,
  deps: { readonly mealPlanService: MealPlanService; readonly logger: Logger },
): void => {
  const { mealPlanService, logger } = deps

  server.registerTool(
    'save_meal_plan',
    {
      description:
        '日付と食事区分つきの食事予定を保存する。同じ日付・食事区分の予定があれば品目と理由を差し替える。予定の保存は食事ログと在庫を変更しない。date は今日以降の JST YYYY-MM-DD。',
      inputSchema: saveMealPlanInput,
      outputSchema: saveMealPlanStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'save_meal_plan' })
      return await mealPlanService
        .save({
          date: args.date,
          mealType: args.meal_type,
          items: args.items.map((item) => ({
            foodMasterId: item.food_master_id,
            foodName: item.food_name,
            quantity: item.quantity,
          })),
          ...(args.reason === undefined ? {} : { reason: args.reason }),
        })
        .match(
          (plan) => {
            const payload = toMealPlanPayload(plan)
            logger.log(TOOL_SUCCEEDED, { tool: 'save_meal_plan' })
            return {
              content: [
                { type: 'text' as const, text: '食事予定を保存しました。' },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'save_meal_plan', error, {
              code: error.code,
              structuredContent: structuredError(error),
            }),
        )
    },
  )

  server.registerTool(
    'list_meal_plans',
    {
      description:
        '指定期間の食事予定を返す。period_from は含み、period_to は含まない。取消済みの予定も status つきで返す。',
      inputSchema: listMealPlansInput,
      outputSchema: listMealPlansStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'list_meal_plans' })
      return await mealPlanService.list(args.period_from, args.period_to).match(
        (plans) => {
          logger.log(TOOL_SUCCEEDED, {
            tool: 'list_meal_plans',
            plan_count: plans.length,
          })
          return {
            content: [
              { type: 'text' as const, text: '食事予定を取得しました。' },
            ],
            structuredContent: {
              meal_plans: plans.map(toMealPlanPayload),
            },
          }
        },
        (error) =>
          errorResult(logger, 'list_meal_plans', error, {
            code: error.code,
            structuredContent: structuredError(error),
          }),
      )
    },
  )

  server.registerTool(
    'cancel_meal_plan',
    {
      description:
        '食事予定を取り消す。取消した予定を返す。食事ログと在庫は変更しない。',
      inputSchema: cancelMealPlanInput,
      outputSchema: cancelMealPlanStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'cancel_meal_plan' })
      return await mealPlanService.cancel(args.meal_plan_id).match(
        (plan) => {
          logger.log(TOOL_SUCCEEDED, { tool: 'cancel_meal_plan' })
          return {
            content: [
              { type: 'text' as const, text: '食事予定を取り消しました。' },
            ],
            structuredContent: toMealPlanPayload(plan),
          }
        },
        (error) =>
          errorResult(logger, 'cancel_meal_plan', error, {
            code: error.code,
            structuredContent: structuredError(error),
          }),
      )
    },
  )
}
