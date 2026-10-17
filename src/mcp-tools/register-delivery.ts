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
  registerDeliveryInput,
} from '#mcp-tools/schemas'

export const registerRegisterDeliveryTool = (
  server: McpServer,
  deps: {
    readonly stockService: StockService
    readonly logger: Logger
  },
): void => {
  const { stockService, logger } = deps
  server.registerTool(
    'register_delivery',
    {
      description:
        '入荷予定を登録・更新する。同じ source_ref の配送は 1 件に保ち、変更時は status と items を更新し、キャンセル時は status を cancelled にする。status が planned の場合、items に指定する食品は事前に set_stock_item で在庫管理の対象にしてください。対象外の食品を指定するとエラーになります。status が cancelled の場合、items は無視されます。',
      inputSchema: registerDeliveryInput,
      outputSchema: deliveryStructuredOutput,
      annotations: { readOnlyHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'register_delivery' })
      return stockService
        .registerDelivery({
          ...(args.source_ref === undefined
            ? {}
            : { sourceRef: args.source_ref }),
          status: args.status,
          expectedDate: args.expected_date,
          ...(args.change_deadline === undefined
            ? {}
            : { changeDeadline: args.change_deadline }),
          items: args.items.map((item) => ({
            foodMasterId: item.food_master_id,
            quantity: item.quantity,
          })),
        })
        .match(
          (delivery) => {
            const payload = buildDeliveryPayload(delivery)
            logger.log(TOOL_SUCCEEDED, {
              tool: 'register_delivery',
              delivery_id: delivery.id,
              status: delivery.status,
            })
            return {
              content: [
                { type: 'text' as const, text: '入荷予定を保存しました。' },
              ],
              structuredContent: payload,
            }
          },
          (error) =>
            errorResult(logger, 'register_delivery', error, {
              code: `stock/${error.code}`,
            }),
        )
    },
  )
}
