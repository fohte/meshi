import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import {
  buildDeliveryPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import {
  deliveryStructuredOutput,
  receiveDeliveryInput,
} from '#mcp-tools/schemas'

export const registerReceiveDeliveryTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'receive_delivery',
    {
      description:
        'planned な配送を受領済みにする。received_date を記録し、items に実数を指定した食品は予定数を置き換える。未指定の食品は予定数を使う。',
      inputSchema: receiveDeliveryInput,
      outputSchema: deliveryStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'receive_delivery' })
      return stockService
        .receiveDelivery({
          deliveryId: args.delivery_id,
          receivedDate: args.received_date,
          ...(args.items === undefined
            ? {}
            : {
                items: args.items.map((item) => ({
                  foodMasterId: item.food_master_id,
                  quantity: item.quantity,
                })),
              }),
        })
        .match(
          (delivery) => {
            const payload = buildDeliveryPayload(delivery)
            logger.log(TOOL_SUCCEEDED, {
              tool: 'receive_delivery',
              delivery_id: delivery.id,
            })
            return {
              content: [
                { type: 'text' as const, text: '配送の受領を保存しました。' },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'receive_delivery', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
