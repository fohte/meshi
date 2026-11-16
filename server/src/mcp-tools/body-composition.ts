import type { McpServer } from '@modelcontextprotocol/server'

import type { BodyCompositionService } from '#domain/body-composition/body-composition-service'
import type { Logger } from '#logger'
import {
  BODY_COMPOSITION_GUIDANCE,
  deleteBodyCompositionInput,
  deleteBodyCompositionStructuredOutput,
  listBodyCompositionsInput,
  listBodyCompositionsStructuredOutput,
  recordBodyCompositionInput,
  recordBodyCompositionStructuredOutput,
  updateBodyCompositionInput,
  updateBodyCompositionStructuredOutput,
} from '#mcp-tools/body-composition-schemas'
import {
  buildBodyCompositionPayload,
  errorResultWithCode,
  TOOL_CALLED,
  TOOL_SUCCEEDED,
} from '#mcp-tools/payloads'

export const registerBodyCompositionTools = (
  server: McpServer,
  deps: {
    readonly bodyCompositionService: BodyCompositionService
    readonly logger: Logger
  },
): void => {
  const { bodyCompositionService, logger } = deps

  server.registerTool(
    'record_body_composition',
    {
      description: `体組成計の測定値を記録する。date と device は必須で、3 項目のうち少なくとも 1 つを指定する。${BODY_COMPOSITION_GUIDANCE}`,
      inputSchema: recordBodyCompositionInput,
      outputSchema: recordBodyCompositionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'record_body_composition' })
      return bodyCompositionService
        .record({
          date: args.date,
          device: args.device,
          ...(args.measured_at === undefined
            ? {}
            : { measuredAt: new Date(args.measured_at) }),
          ...(args.body_fat_percent === undefined
            ? {}
            : { bodyFatPercent: args.body_fat_percent }),
          ...(args.muscle_mass_kg === undefined
            ? {}
            : { muscleMassKg: args.muscle_mass_kg }),
          ...(args.skeletal_muscle_percent === undefined
            ? {}
            : { skeletalMusclePercent: args.skeletal_muscle_percent }),
        })
        .match(
          (bodyComposition) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'record_body_composition' })
            return {
              content: [
                { type: 'text' as const, text: '体組成を記録しました。' },
              ],
              structuredContent: buildBodyCompositionPayload(bodyComposition),
            }
          },
          (error) =>
            errorResultWithCode(logger, 'record_body_composition', error, {
              logMessage: error.code,
            }),
        )
    },
  )

  server.registerTool(
    'list_body_compositions',
    {
      description: `from 以上、to 以下 (どちらも含む) の期間の体組成記録を返す。${BODY_COMPOSITION_GUIDANCE}`,
      inputSchema: listBodyCompositionsInput,
      outputSchema: listBodyCompositionsStructuredOutput,
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'list_body_compositions' })
      return bodyCompositionService.list(args.from, args.to).match(
        (bodyCompositions) => {
          const payload = bodyCompositions.map(buildBodyCompositionPayload)
          logger.log(TOOL_SUCCEEDED, {
            tool: 'list_body_compositions',
            body_composition_count: payload.length,
          })
          return {
            content: [
              {
                type: 'text' as const,
                text: `${String(payload.length)} 件の体組成記録を取得しました。`,
              },
            ],
            structuredContent: { body_compositions: payload },
          }
        },
        (error) =>
          errorResultWithCode(logger, 'list_body_compositions', error, {
            logMessage: error.code,
          }),
      )
    },
  )

  server.registerTool(
    'update_body_composition',
    {
      description: `body_composition_id で指定した体組成記録を部分更新する。measured_at と各測定値は null で消せる。${BODY_COMPOSITION_GUIDANCE}`,
      inputSchema: updateBodyCompositionInput,
      outputSchema: updateBodyCompositionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: false },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'update_body_composition' })
      return bodyCompositionService
        .update({
          id: args.body_composition_id,
          ...(args.date === undefined ? {} : { date: args.date }),
          ...(args.measured_at === undefined
            ? {}
            : {
                measuredAt:
                  args.measured_at === null ? null : new Date(args.measured_at),
              }),
          ...(args.device === undefined ? {} : { device: args.device }),
          ...(args.body_fat_percent === undefined
            ? {}
            : { bodyFatPercent: args.body_fat_percent }),
          ...(args.muscle_mass_kg === undefined
            ? {}
            : { muscleMassKg: args.muscle_mass_kg }),
          ...(args.skeletal_muscle_percent === undefined
            ? {}
            : { skeletalMusclePercent: args.skeletal_muscle_percent }),
        })
        .match(
          (bodyComposition) => {
            logger.log(TOOL_SUCCEEDED, { tool: 'update_body_composition' })
            return {
              content: [
                { type: 'text' as const, text: '体組成記録を更新しました。' },
              ],
              structuredContent: buildBodyCompositionPayload(bodyComposition),
            }
          },
          (error) =>
            errorResultWithCode(logger, 'update_body_composition', error, {
              logMessage: error.code,
            }),
        )
    },
  )

  server.registerTool(
    'delete_body_composition',
    {
      description: `body_composition_id で指定した体組成記録を削除する。${BODY_COMPOSITION_GUIDANCE}`,
      inputSchema: deleteBodyCompositionInput,
      outputSchema: deleteBodyCompositionStructuredOutput,
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => {
      logger.log(TOOL_CALLED, { tool: 'delete_body_composition' })
      return bodyCompositionService.delete(args.body_composition_id).match(
        () => {
          logger.log(TOOL_SUCCEEDED, { tool: 'delete_body_composition' })
          return {
            content: [
              { type: 'text' as const, text: '体組成記録を削除しました。' },
            ],
            structuredContent: {
              body_composition_id: args.body_composition_id,
            },
          }
        },
        (error) =>
          errorResultWithCode(logger, 'delete_body_composition', error, {
            logMessage: error.code,
          }),
      )
    },
  )
}
