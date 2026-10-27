import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import {
  updateDeliverySourceRefInput,
  updateDeliverySourceRefStructuredOutput,
} from '#mcp-tools/delivery-schemas'
import {
  buildListedDeliveryPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'

export const registerUpdateDeliverySourceRefTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'update_delivery_source_ref',
    {
      description:
        '配送の source_ref だけを訂正する。受領済みや取消済みでも使え、参照の訂正では在庫や食事ログの関連・残数は変わらない。受領前の明細・到着予定日は register_delivery、残数は count_stock、賞味期限・食べ切り目標日は update_stock_lot を使う。受領日・受領数は訂正できない。',
      inputSchema: updateDeliverySourceRefInput,
      outputSchema: updateDeliverySourceRefStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_delivery_source_ref' })
      return stockService
        .updateDeliverySourceRef({
          deliveryId: args.delivery_id,
          sourceRef: args.source_ref,
        })
        .match(
          (delivery) => {
            const payload = buildListedDeliveryPayload(delivery)
            logger.log(TOOL_SUCCEEDED, {
              tool: 'update_delivery_source_ref',
              delivery_id: delivery.id,
              source_ref: delivery.sourceRef,
            })
            return {
              content: [
                { type: 'text' as const, text: '配送の参照を訂正しました。' },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'update_delivery_source_ref', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
