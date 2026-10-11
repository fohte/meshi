import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  registerFoodInput,
  registerFoodStructuredOutput,
  similarFoodMasterCandidateOutput,
} from '#mcp-tools/schemas'

const description =
  '未登録の食品を登録し、food_master_id と名前を返す。nutrition.energy_kcal は必須。栄養値を一般知識から作らない。出典はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。name はブランド名を先頭に付け、残りは公式の商品名をそのまま書く。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。食品成分表に載っている自炊の素材は成分表から登録する。似た名前の候補が返されたら、同じ食品なら既存候補を使う。確信がなければ出典を調べ直すかユーザーに確認する。候補すべてと別物だと確認できた場合のみ、confirmed_distinct_from_master_ids に候補の food_master_id をすべて指定して再送する。'

const similarNameDetailsSchema = z.object({
  candidates: z.array(similarFoodMasterCandidateOutput),
})

export const registerFoodResult = (
  result: ReturnType<FoodMasterService['registerWithSimilarNameCheck']>,
  logger: Logger,
  toolName: string,
) =>
  result.match(
    (foodMaster) => {
      logger.log(TOOL_SUCCEEDED, { tool: toolName })
      return {
        content: [{ type: 'text' as const, text: '食品を登録しました。' }],
        structuredContent: {
          food_master_id: foodMaster.id,
          name: foodMaster.name,
        },
      }
    },
    (error) => {
      const code = `food_master/${error.code}`
      const similarDetails = similarNameDetailsSchema.safeParse(error.details)
      return errorResult(logger, toolName, error, {
        code,
        structuredContent: {
          error: {
            code,
            message: error.message,
            ...(similarDetails.success
              ? { candidates: similarDetails.data.candidates }
              : {}),
          },
        },
      })
    },
  )

export const registerFoodTool = (
  server: McpServer,
  deps: {
    readonly foodMasterService: FoodMasterService
    readonly logger: Logger
  },
): void => {
  const { foodMasterService, logger } = deps

  server.registerTool(
    'register_food',
    {
      description,
      inputSchema: registerFoodInput,
      outputSchema: registerFoodStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'register_food' })
      return await registerFoodResult(
        foodMasterService.registerWithSimilarNameCheck(
          {
            name: args.name,
            ...(args.aliases === undefined ? {} : { aliases: args.aliases }),
            nutrition: args.nutrition,
            source: args.source,
            isEstimated: args.is_estimated,
            ...(args.source_url === undefined
              ? {}
              : { sourceUrl: args.source_url }),
          },
          args.confirmed_distinct_from_master_ids,
        ),
        logger,
        'register_food',
      )
    },
  )
}
