import type { CallToolResult } from '@modelcontextprotocol/server'

import { toMealHistoryPayload } from '#domain/meal-history/mealHistoryPayload'
import type { MealHistoryAggregate } from '#domain/meal-history/types'
import type { MealLogDeletionResult } from '#domain/meal-log/types'
import type { UserProfile } from '#domain/user-profile/user-profile'
import type { Logger } from '#logger'

export const TOOL_CALLED = 'meshi.tool_called'
export const TOOL_SUCCEEDED = 'meshi.tool_succeeded'
const TOOL_FAILED = 'meshi.tool_failed'

const toErrorSummary = (message: string): string =>
  message.trim() === '' ? 'meshi 内部でエラーが発生しました。' : message.trim()

export const errorResult = (
  logger: Logger,
  toolName: string,
  err: unknown,
  options: {
    readonly code?: string
    readonly structuredContent?: Record<string, unknown>
  } = {},
): CallToolResult => {
  const message = err instanceof Error ? err.message : String(err)
  const code =
    options.code ??
    (err instanceof Error && err.name !== 'Error' ? err.name : 'internal_error')
  logger.log(TOOL_FAILED, { tool: toolName, code, message })
  return {
    isError: true,
    content: [{ type: 'text', text: toErrorSummary(message) }],
    ...(options.structuredContent === undefined
      ? {}
      : { structuredContent: options.structuredContent }),
  }
}

export const buildMealHistoryPayload = (
  aggregate: MealHistoryAggregate,
): Record<string, unknown> => ({
  ...toMealHistoryPayload(aggregate, { includeRecordedAt: true }),
})

export const buildMealLogMutationPayload = (
  record: MealLogDeletionResult,
): Record<string, unknown> => ({
  meal_log_id: record.id,
  food_master_id: record.foodMasterId,
  food_name: record.foodName,
  eaten_date: record.eatenDate,
  meal_type: record.mealType,
  quantity: record.quantity,
})

export const buildProfilePayload = (
  profile: UserProfile,
): Record<string, unknown> => ({
  likes: profile.likes,
  dislikes: profile.dislikes,
  allergies: profile.allergies,
  constraints: profile.constraints,
  daily_targets: profile.dailyTargets ?? null,
})
