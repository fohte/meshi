import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import {
  listDeliveriesInput,
  listDeliveriesStructuredOutput,
} from '#mcp-tools/delivery-schemas'
import { errorResult, TOOL_CALLED, TOOL_SUCCEEDED } from '#mcp-tools/payloads'

export const registerListDeliveriesTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'list_deliveries',
    {
      description:
        '配送を照会する。delivery_id、現在の source_ref、status を指定した場合はすべての条件に一致する配送を返す。受領済みと全量消費済みの入荷分も含む。受領日 (planned と cancelled は expected_date) の新しい順で返す。limit は省略時 20 件、最大 50 件。',
      inputSchema: listDeliveriesInput,
      outputSchema: listDeliveriesStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'list_deliveries' })
      return stockService
        .listDeliveries({
          ...(args.delivery_id === undefined
            ? {}
            : { deliveryId: args.delivery_id }),
          ...(args.source_ref === undefined
            ? {}
            : { sourceRef: args.source_ref }),
          ...(args.status === undefined ? {} : { status: args.status }),
          limit: args.limit ?? 20,
        })
        .match(
          (deliveries) => {
            const payload = {
              deliveries: deliveries.map((delivery) => ({
                delivery_id: delivery.id,
                source_ref: delivery.sourceRef,
                status: delivery.status,
                expected_date: delivery.expectedDate,
                received_date: delivery.receivedDate,
                change_deadline: delivery.changeDeadline,
                items: delivery.items.map((item) => ({
                  food_master_id: item.foodMasterId,
                  food_name: item.foodName,
                  stock_lot_id: item.stockLotId,
                  quantity: item.quantity,
                  remaining_quantity: item.remainingQuantity,
                })),
              })),
            }
            logger.log(TOOL_SUCCEEDED, {
              tool: 'list_deliveries',
              delivery_count: deliveries.length,
            })
            return {
              content: [
                {
                  type: 'text' as const,
                  text: `${String(deliveries.length)} 件の配送を取得しました。`,
                },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'list_deliveries', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
