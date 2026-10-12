import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { TOOL_CALLED } from '#mcp-tools/payloads'
import { registerFoodResult } from '#mcp-tools/register-food'
import {
  registerFoodStructuredOutput,
  registerFoodWithoutNutritionInput,
} from '#mcp-tools/schemas'

export const registerFoodWithoutNutritionTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps

  server.registerTool(
    'register_food_without_nutrition',
    {
      description:
        '栄養値が不明な食品を登録し、food_master_id と名前を返す。公式情報もユーザーが伝えた値もなく、一般的な材料と量から妥当な推定もできない場合だけ使う。推定できる場合は register_food を使い、登録前にユーザーの確認を取らず、登録後に推定値であることを伝える。栄養値は後から公式情報、ユーザーが伝えた値、またはモデルの推定で補完できる。似た名前の候補が返されたら、同じ食品なら既存候補を使う。食品名や類似候補の同一性が不確かな場合はユーザーに確認する。候補すべてと別物だと確認できた場合のみ、confirmed_distinct_from_master_ids に候補の food_master_id をすべて指定して再送する。',
      inputSchema: registerFoodWithoutNutritionInput,
      outputSchema: registerFoodStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, {
        tool: 'register_food_without_nutrition',
      })
      return await registerFoodResult(
        foodMasterService.registerWithoutNutritionWithSimilarNameCheck(
          {
            name: args.name,
            ...(args.aliases === undefined ? {} : { aliases: args.aliases }),
          },
          args.confirmed_distinct_from_master_ids,
        ),
        logger,
        'register_food_without_nutrition',
      )
    },
  )
}
