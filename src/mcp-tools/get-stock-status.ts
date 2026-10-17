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
        '在庫管理の対象になっている食品の残数、入荷分ごとの日付、保存場所と容量、および受領前の入荷予定を返す。',
      inputSchema: getStockStatusInput,
      outputSchema: getStockStatusStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      logger.log(TOOL_CALLED, { tool: 'get_stock_status' })
      return stockService.getStockStatus().match(
        (status) => {
          const payload = {
            stock_items: status.stockItems.map((item) => ({
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
            planned_deliveries: status.plannedDeliveries.map((delivery) => ({
              delivery_id: delivery.id,
              source_ref: delivery.sourceRef,
              expected_date: delivery.expectedDate,
              change_deadline: delivery.changeDeadline,
              items: delivery.items.map((item) => ({
                food_master_id: item.foodMasterId,
                food_name: item.foodName,
                quantity: item.quantity,
              })),
            })),
          }
          logger.log(TOOL_SUCCEEDED, {
            tool: 'get_stock_status',
            stock_item_count: status.stockItems.length,
            planned_delivery_count: status.plannedDeliveries.length,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `${String(status.stockItems.length)} 件の在庫状況と ${String(status.plannedDeliveries.length)} 件の入荷予定を取得しました。`,
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
