import type { McpServer } from '@modelcontextprotocol/server'
import { z } from 'zod'

import type { WeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
import type { WeightOutlookService } from '#domain/weight-outlook/weight-outlook-service'
import type { Logger } from '#logger'
import {
  buildWeightOutlookPayload,
  errorResult,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'
import { weightOutlookStructuredOutput } from '#mcp-tools/weight-outlook-schemas'

const getStatusText = (outlook: WeightOutlook): string => {
  switch (outlook.status) {
    case 'insufficient_data':
      switch (outlook.reason) {
        case 'first_measurement_too_recent':
          return '体重記録を始めてから 28 日に満たないため、見通しを出せません。'
        case 'too_few_measurement_days':
          return '直近 28 日の測定日が 16 日未満のため、見通しを出せません。'
        case 'measurement_gap':
          return '直近 28 日に週 2 日以上の測定がない週があるため、見通しを出せません。'
        case null:
          return '体重データが不足しているため、見通しを出せません。'
      }
    case 'no_goal':
      return '目標体重が未設定のため、到達時期を出せません。'
    case 'reached':
      return '推定トレンドでは目標体重に到達しています。'
    case 'not_approaching':
      return '現在の傾向では目標体重に近づいていません。'
    case 'no_arrival_estimate':
      return '現在の傾向から 12 週以内の到達時期を推定できません。'
    case 'arrival_estimate':
      return outlook.arrivalDateRange === null
        ? '現在の傾向から到達時期を推定できません。'
        : `今のペースが続けば、目標体重への到達時期は ${outlook.arrivalDateRange.from} から ${outlook.arrivalDateRange.to} 頃です。未検証の目安です。`
  }
}

export const registerGetWeightOutlookTool = (
  server: McpServer,
  deps: {
    readonly weightOutlookService: WeightOutlookService
    readonly logger: Logger
  },
): void => {
  const { logger, weightOutlookService } = deps

  server.registerTool(
    'get_weight_outlook',
    {
      description:
        '実測体重から計算した現在の傾向と目標体重への見通しを返す。到達時期は今のペースが続く場合の未検証の目安として扱う。',
      inputSchema: z.object({}),
      outputSchema: weightOutlookStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async () => {
      logger.log(TOOL_CALLED, { tool: 'get_weight_outlook' })
      return weightOutlookService.get().match(
        (outlook) => {
          logger.log(TOOL_SUCCEEDED, { tool: 'get_weight_outlook' })
          return {
            content: [{ type: 'text' as const, text: getStatusText(outlook) }],
            structuredContent: buildWeightOutlookPayload(outlook),
          }
        },
        (error) => errorResult(logger, 'get_weight_outlook', error),
      )
    },
  )
}
