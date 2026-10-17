import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import {
  buildDeliveryItemPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
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
        '在庫管理の対象になっている食品の残数、受領前の入荷予定、容量超過と食べ切り目標の警告、および先に食べたい入荷分を返す。',
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
              items: delivery.items.map(buildDeliveryItemPayload),
            })),
            capacity_warnings: status.capacityWarnings.map((warning) => ({
              id: warning.id,
              storage_location_id: warning.storageLocationId,
              storage_location_name: warning.storageLocationName,
              expected_date: warning.expectedDate,
              deliveries: warning.deliveries.map((delivery) => ({
                delivery_id: delivery.deliveryId,
                change_deadline: delivery.changeDeadline,
              })),
              projected_quantity: warning.projectedQuantity,
              capacity: warning.capacity,
              excess_quantity: warning.excessQuantity,
            })),
            eat_by_warnings: status.eatByWarnings.map((warning) => ({
              id: warning.id,
              risk_type: warning.riskType,
              stock_lot_id: warning.stockLotId,
              food_master_id: warning.foodMasterId,
              food_name: warning.foodName,
              target_date: warning.targetDate,
              target_date_type: warning.targetDateType,
              remaining_quantity: warning.remainingQuantity,
              quantity_used_for_rate: warning.quantityUsedForRate,
              days_until_target: warning.daysUntilTarget,
              required_daily_consumption: warning.requiredDailyConsumption,
              actual_daily_consumption: warning.actualDailyConsumption,
            })),
            priority_lots: status.priorityLots.map((lot) => ({
              food_master_id: lot.foodMasterId,
              food_name: lot.foodName,
              stock_lot_id: lot.stockLotId,
              remaining_quantity: lot.remainingQuantity,
              target_date: lot.targetDate,
              reasons: lot.reasons,
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
