import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import { countStockInput, countStockStructuredOutput } from '#mcp-tools/schemas'

export const registerCountStockTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'count_stock',
    {
      description:
        '棚卸しで数えた実数を登録する。在庫管理の対象にしていない食品は指定できない。数が減った場合は古い入荷分から調整し、増えた場合は新しい入荷分として記録する。',
      inputSchema: countStockInput,
      outputSchema: countStockStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'count_stock' })
      return stockService
        .countStock({
          foodMasterId: args.food_master_id,
          quantity: args.quantity,
          ...(args.received_date === undefined
            ? {}
            : { receivedDate: args.received_date }),
          ...(args.best_before === undefined
            ? {}
            : { bestBefore: args.best_before }),
        })
        .match(
          (result) => {
            const payload = {
              food_master_id: result.foodMasterId,
              previous_quantity: result.previousQuantity,
              counted_quantity: result.countedQuantity,
              difference: result.difference,
            }
            logger.log(TOOL_SUCCEEDED, { tool: 'count_stock' })
            return {
              content: [
                { type: 'text' as const, text: '棚卸し結果を保存しました。' },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'count_stock', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
