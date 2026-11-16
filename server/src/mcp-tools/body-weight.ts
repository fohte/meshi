import type { McpServer } from '@modelcontextprotocol/server'

import type { BodyWeightService } from '#domain/body-weight/body-weight-service'
import type { Logger } from '#logger'
import {
  deleteBodyWeightInput,
  deleteBodyWeightStructuredOutput,
  listBodyWeightsInput,
  listBodyWeightsStructuredOutput,
  recordBodyWeightInput,
  recordBodyWeightStructuredOutput,
  updateBodyWeightInput,
  updateBodyWeightStructuredOutput,
} from '#mcp-tools/body-weight-schemas'
import {
  buildBodyWeightPayload,
  errorResultWithCode,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'

export const registerBodyWeightTools = (
  server: McpServer,
  deps: {
    readonly bodyWeightService: BodyWeightService
    readonly logger: Logger
  },
): void => {
  const { bodyWeightService, logger } = deps

  server.registerTool(
    'record_body_weight',
    {
      description:
        '体重を記録する。利用者が日付と体重を伝えたときに使う。measured_at は利用者が測定時刻を伝えた場合だけ指定する。',
      inputSchema: recordBodyWeightInput,
      outputSchema: recordBodyWeightStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'record_body_weight' })
      return bodyWeightService
        .record({
          date: args.date,
          weightKg: args.weight_kg,
          ...(args.measured_at === undefined
            ? {}
            : { measuredAt: new Date(args.measured_at) }),
        })
        .match(
          (bodyWeight) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'record_body_weight' })
            return {
              content: [
                { type: 'text' as const, text: '体重を記録しました。' },
              ],
              structuredContent: buildBodyWeightPayload(bodyWeight),
            }
          },
          (error) => errorResultWithCode(logger, 'record_body_weight', error),
        )
    },
  )

  server.registerTool(
    'list_body_weights',
    {
      description: 'from 以上、to 以下 (どちらも含む) の期間の体重記録を返す。',
      inputSchema: listBodyWeightsInput,
      outputSchema: listBodyWeightsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'list_body_weights' })
      return bodyWeightService.list(args.from, args.to).match(
        (bodyWeights) => {
          const payload = bodyWeights.map(buildBodyWeightPayload)
          logger.log(TOOL_SUCCEEDED, {
            tool: 'list_body_weights',
            body_weight_count: payload.length,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `${String(payload.length)} 件の体重記録を取得しました。`,
              },
            ],
            structuredContent: { body_weights: payload },
          }
        },
        (error) => errorResultWithCode(logger, 'list_body_weights', error),
      )
    },
  )

  server.registerTool(
    'update_body_weight',
    {
      description:
        'body_weight_id で指定した体重記録を部分更新する。measured_at に null を指定すると測定時刻を消す。',
      inputSchema: updateBodyWeightInput,
      outputSchema: updateBodyWeightStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_body_weight' })
      return bodyWeightService
        .update({
          id: args.body_weight_id,
          ...(args.date === undefined ? {} : { date: args.date }),
          ...(args.weight_kg === undefined ? {} : { weightKg: args.weight_kg }),
          ...(args.measured_at === undefined
            ? {}
            : {
                measuredAt:
                  args.measured_at === null ? null : new Date(args.measured_at),
              }),
        })
        .match(
          (bodyWeight) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'update_body_weight' })
            return {
              content: [
                { type: 'text' as const, text: '体重記録を更新しました。' },
              ],
              structuredContent: buildBodyWeightPayload(bodyWeight),
            }
          },
          (error) => errorResultWithCode(logger, 'update_body_weight', error),
        )
    },
  )

  server.registerTool(
    'delete_body_weight',
    {
      description: 'body_weight_id で指定した体重記録を削除する。',
      inputSchema: deleteBodyWeightInput,
      outputSchema: deleteBodyWeightStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'delete_body_weight' })
      return bodyWeightService.delete(args.body_weight_id).match(
        () => {
          logger.log(TOOL_SUCCEEDED, { tool: 'delete_body_weight' })
          return {
            content: [
              { type: 'text' as const, text: '体重記録を削除しました。' },
            ],
            structuredContent: { body_weight_id: args.body_weight_id },
          }
        },
        (error) => errorResultWithCode(logger, 'delete_body_weight', error),
      )
    },
  )
}
