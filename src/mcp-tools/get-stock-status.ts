import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'
import {
  getStockStatusInput,
  getStockStatusStructuredOutput,
} from '#mcp-tools/schemas'

export const registerGetStockStatusTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'get_stock_status',
    {
      description:
        '在庫管理の対象になっている食品について、合計残数、入荷分ごとの残数と日付、保存場所と容量を返す。',
      inputSchema: getStockStatusInput,
      outputSchema: getStockStatusStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      logger.log(TOOL_CALLED, { tool: 'get_stock_status' })
      return stockService.getStockStatus().match(
        (items) => {
          const payload = {
            stock_items: items.map((item) => ({
              food_master_id: item.foodMasterId,
              food_name: item.foodName,
              total_quantity: item.totalQuantity,
              storage_location: item.storageLocation,
              eat_within_days: item.eatWithinDays,
              lots: item.lots.map((lot) => ({
                stock_lot_id: lot.id,
                quantity: lot.quantity,
                remaining_quantity: lot.remainingQuantity,
                received_date: lot.receivedDate,
                best_before: lot.bestBefore,
                eat_by: lot.eatBy,
              })),
            })),
          }
          logger.log(TOOL_SUCCEEDED, {
            tool: 'get_stock_status',
            stock_item_count: items.length,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `${String(items.length)} 件の在庫状況を取得しました。`,
              },
            ],
            structuredContent: payload,
          }
        },
        (error) =>
          errorResult(logger, 'get_stock_status', error, {
            code: `stock/${error.code}`,
          }),
      )
    },
  )
}
