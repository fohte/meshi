import type { McpServer } from '@modelcontextprotocol/server'

import type { StockService } from '#domain/stock/types'
import type { Logger } from '#logger'
import {
  listDeliveriesInput,
  listDeliveriesStructuredOutput,
} from '#mcp-tools/delivery-schemas'
import {
  buildListedDeliveryPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'

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
        '配送を照会する。delivery_id、現在または訂正前の source_ref、status を指定した場合はすべての条件に一致する配送を返す。参照の履歴と日時も返す。受領済みと全量消費済みの入荷分も含む。受領日 (planned と cancelled は expected_date) の新しい順で返す。limit は省略時 20 件、最大 50 件。',
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
              deliveries: deliveries.map(buildListedDeliveryPayload),
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
