import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService, UpdatedStockLot } from '#domain/stock/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  updateStockLotInput,
  updateStockLotStructuredOutput,
} from '#mcp-tools/schemas'

const buildStockLotDatesPayload = (lot: UpdatedStockLot) => ({
  stock_lot_id: lot.id,
  best_before: lot.bestBefore,
  eat_by: lot.eatBy,
})

export const registerUpdateStockLotTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'update_stock_lot',
    {
      description:
        '入荷分の賞味期限 (best_before) と食べ切り目標日 (eat_by) を更新する。渡した値だけを変更し、null で消去する。',
      inputSchema: updateStockLotInput,
      outputSchema: updateStockLotStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_stock_lot' })
      return stockService
        .updateStockLot({
          stockLotId: args.stock_lot_id,
          ...(args.best_before === undefined
            ? {}
            : { bestBefore: args.best_before }),
          ...(args.eat_by === undefined ? {} : { eatBy: args.eat_by }),
        })
        .match(
          (lot) => {
            const payload = buildStockLotDatesPayload(lot)
            logger.log(TOOL_SUCCEEDED, {
              tool: 'update_stock_lot',
              stock_lot_id: lot.id,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: '入荷分の日付を更新しました。',
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'update_stock_lot', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
