import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

import type { UserProfile } from '@/domain/user-profile/user-profile'
import type {
  MealHistoryResult,
  MealRecordResult,
  OrchestratorError,
  RecommendResult,
} from '@/llm/orchestrator'
import type { Logger } from '@/logger'

export const TOOL_CALLED = 'meshi.tool_called'
export const TOOL_SUCCEEDED = 'meshi.tool_succeeded'
const TOOL_FAILED = 'meshi.tool_failed'

const toErrorSummary = (message: string): string =>
  message.trim() === '' ? 'meshi 内部でエラーが発生しました。' : message.trim()

export const errorResult = (
  logger: Logger,
  toolName: string,
  err: unknown,
): CallToolResult => {
  const message = err instanceof Error ? err.message : String(err)
  const code =
    err instanceof Error && err.name !== 'Error' ? err.name : 'internal_error'
  logger.log(TOOL_FAILED, { tool: toolName, code, message })
  // structuredContent omitted: there is no shape that satisfies every tool's
  // outputSchema simultaneously.
  return {
    isError: true,
    content: [{ type: 'text', text: toErrorSummary(message) }],
  }
}

export const buildMealRecordPayload = (
  result: MealRecordResult,
): Record<string, unknown> => ({
  recorded: result.recorded.map((r) => ({
    meal_log_id: r.mealLogId,
    food_master_id: r.foodMasterId,
    nutrition: r.nutrition,
    is_estimated: r.isEstimated,
  })),
  candidates: result.candidates.map((c) => ({
    food_master_id: c.foodMasterId,
    composition_code: c.compositionCode,
    name: c.name,
    is_estimated: c.isEstimated,
    score: c.score,
    reason: c.reason,
  })),
  has_estimated_values: result.hasEstimatedValues,
  error: orchestratorErrorPayload(result.error),
})

export const buildMealHistoryPayload = (
  result: MealHistoryResult,
): Record<string, unknown> => ({
  aggregate:
    result.aggregate === null
      ? null
      : {
          totals: result.aggregate.totals,
          per_day: result.aggregate.perDay.map((d) => ({
            date: d.date,
            totals: d.totals,
          })),
          entries: result.aggregate.entries.map((e) => ({
            meal_log_id: e.mealLogId,
            food_master_id: e.foodMasterId,
            eaten_at_iso: e.eatenAtIso,
            quantity: e.quantity,
            unit: e.unit,
            note: e.note,
          })),
          has_estimated_values: result.aggregate.hasEstimatedValues,
        },
  has_estimated_values: result.hasEstimatedValues,
  error: orchestratorErrorPayload(result.error),
})

export const buildRecommendPayload = (
  result: RecommendResult,
): Record<string, unknown> => ({
  error: orchestratorErrorPayload(result.error),
})

const orchestratorErrorPayload = (
  error: OrchestratorError | null,
): Record<string, unknown> | null =>
  error === null ? null : { kind: error.kind, message: error.message }

export const buildProfilePayload = (
  profile: UserProfile,
): Record<string, unknown> => ({
  likes: profile.likes,
  dislikes: profile.dislikes,
  allergies: profile.allergies,
  constraints: profile.constraints,
  daily_targets: profile.dailyTargets ?? null,
})

export const logOrchestratorOutcome = (
  logger: Logger,
  toolName: string,
  error: OrchestratorError | null,
  extras: Readonly<Record<string, unknown>>,
): void => {
  if (error === null) {
    logger.log(TOOL_SUCCEEDED, { tool: toolName, ...extras })
    return
  }
  logger.log(TOOL_FAILED, {
    tool: toolName,
    code: error.kind,
    message: error.message,
    ...extras,
  })
}

export const orchestratorCallToolResult = (
  summaryText: string,
  payload: Record<string, unknown>,
  error: OrchestratorError | null,
): CallToolResult => {
  const result: CallToolResult = {
    content: [{ type: 'text', text: summaryText }],
    structuredContent: payload,
  }
  if (error !== null) {
    result.isError = true
  }
  return result
}
