import type { McpServer } from '@modelcontextprotocol/server'

import type { MealSetService } from '#domain/meal-set/meal-set-service'
import type { Logger } from '#logger'
import {
  buildMealSetPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  registerMealSetInput,
  registerMealSetStructuredOutput,
} from '#mcp-tools/schemas'

const description =
  'マイセットを登録する。name はセット名、items は food_master_id と quantity の組み合わせ。quantity は食品 1 つ分への倍率。'

export const registerMealSetTool = (
  server: McpServer,
  deps: {
    readonly mealSetService: MealSetService
    readonly logger: Logger
  },
): void => {
  const { mealSetService, logger } = deps

  server.registerTool(
    'register_meal_set',
    {
      description,
      inputSchema: registerMealSetInput,
      outputSchema: registerMealSetStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'register_meal_set' })
      return await mealSetService
        .register({
          name: args.name,
          items: args.items.map((item) => ({
            foodMasterId: item.food_master_id,
            quantity: item.quantity,
          })),
        })
        .match(
          (mealSet) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'register_meal_set' })
            return {
              content: [
                { type: 'text' as const, text: 'マイセットを登録しました。' },
              ],
              structuredContent: buildMealSetPayload(mealSet),
            }
          },
          (error) =>
            errorResult(logger, 'register_meal_set', error, {
              code: error.code,
              structuredContent: {
                error: { code: error.code, message: error.message },
              },
            }),
        )
    },
  )
}
