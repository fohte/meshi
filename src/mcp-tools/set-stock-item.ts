import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  setStockItemInput,
  setStockItemStructuredOutput,
} from '#mcp-tools/schemas'

export const registerSetStockItemTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'set_stock_item',
    {
      description:
        'food_master_id の食品を在庫管理の対象にする。保存場所は名前で指定し、未登録なら作成する。eat_within_days は受領日から食べ切りたい日数。値を省略すると既存の設定を維持し、null で解除する。',
      inputSchema: setStockItemInput,
      outputSchema: setStockItemStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'set_stock_item' })
      return stockService
        .setStockItem({
          foodMasterId: args.food_master_id,
          ...(args.storage_location_name === undefined
            ? {}
            : { storageLocationName: args.storage_location_name }),
          ...(args.storage_location_capacity === undefined
            ? {}
            : { storageLocationCapacity: args.storage_location_capacity }),
          ...(args.eat_within_days === undefined
            ? {}
            : { eatWithinDays: args.eat_within_days }),
        })
        .match(
          (item) => {
            const payload = {
              food_master_id: item.foodMasterId,
              food_name: item.foodName,
              storage_location: item.storageLocation,
              eat_within_days: item.eatWithinDays,
            }
            logger.log(TOOL_SUCCEEDED, { tool: 'set_stock_item' })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '在庫管理の設定を保存しました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'set_stock_item', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
