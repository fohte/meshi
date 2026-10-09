import type { McpServer } from '@modelcontextprotocol/server'

import type { FoodMasterService } from '#domain/food-master/service'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  registerFoodFromCompositionInput,
  registerFoodFromCompositionStructuredOutput,
} from '#mcp-tools/schemas'

interface FoodCompositionToolDeps {
  readonly foodMasterService: FoodMasterService
  readonly logger: Logger
}

export const registerFoodFromCompositionTool = (
  server: McpServer,
  deps: FoodCompositionToolDeps,
): void => {
  const { foodMasterService, logger } = deps

  server.registerTool(
    'register_food_from_composition',
    {
      description:
        '食品成分表の composition_code から食品マスタを登録する。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。栄養値は食品成分表から 100g あたりの値をコピーするため、入力では指定できない。',
      inputSchema: registerFoodFromCompositionInput,
      outputSchema: registerFoodFromCompositionStructuredOutput,
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'register_food_from_composition' })
      return await foodMasterService
        .registerFromComposition({
          compositionCode: args.composition_code,
          ...(args.name === undefined ? {} : { name: args.name }),
          ...(args.aliases === undefined ? {} : { aliases: args.aliases }),
        })
        .match(
          ({ foodMaster }) => {
            const payload = {
              food_master_id: foodMaster.id,
              name: foodMaster.name,
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'register_food_from_composition',
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '食品成分表から食品を登録しました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'register_food_from_composition', error, {
              code: `food_master/${error.code}`,
            }),
        )
    },
  )
}
