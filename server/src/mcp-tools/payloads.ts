import type { CallToolResult } from '@modelcontextprotocol/server'

import type { BodyComposition } from '#domain/body-composition/types'
import type { BodyWeight } from '#domain/body-weight/types'
import { toMealHistoryPayload } from '#domain/meal-history/mealHistoryPayload'
import type { MealHistoryAggregate } from '#domain/meal-history/types'
import type { MealLogDeletionResult } from '#domain/meal-log/types'
import type { MealSet } from '#domain/meal-set/types'
import type {
  Delivery,
  DeliveryItem,
  ListedDelivery,
} from '#domain/stock/types'
import type { UserProfile } from '#domain/user-profile/user-profile'
import type { WeightOutlook } from '#domain/weight-outlook/weight-outlook-calculator'
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
    readonly logMessage?: string
    readonly structuredContent?: Record<string, unknown>
  } = {},
): CallToolResult => {
  const message = err instanceof Error ? err.message : String(err)
  const logMessage = options.logMessage ?? message
  const code =
    options.code ??
    (err instanceof Error && err.name !== 'Error' ? err.name : 'internal_error')
  logger.log(TOOL_FAILED, { tool: toolName, code, message: logMessage })
  return {
    isError: true,
    content: [{ type: 'text', text: toErrorSummary(message) }],
    ...(options.structuredContent === undefined
      ? {}
      : { structuredContent: options.structuredContent }),
  }
}

export const errorResultWithCode = (
  logger: Logger,
  toolName: string,
  error: { readonly code: string; readonly message: string },
  options: { readonly logMessage?: string } = {},
) =>
  errorResult(logger, toolName, error, {
    code: error.code,
    structuredContent: {
      error: { code: error.code, message: error.message },
    },
    ...options,
  })

export const buildMealHistoryPayload = (
  aggregate: MealHistoryAggregate,
): Record<string, unknown> => ({
  ...toMealHistoryPayload(aggregate, { includeRecordedAt: true }),
})

export const buildBodyWeightPayload = (bodyWeight: BodyWeight) => ({
  body_weight_id: bodyWeight.id,
  date: bodyWeight.date,
  measured_at: bodyWeight.measuredAt?.toISOString() ?? null,
  weight_kg: bodyWeight.weightKg,
  created_at: bodyWeight.createdAt.toISOString(),
  updated_at: bodyWeight.updatedAt.toISOString(),
})

export const buildBodyCompositionPayload = (
  bodyComposition: BodyComposition,
) => ({
  body_composition_id: bodyComposition.id,
  date: bodyComposition.date,
  measured_at: bodyComposition.measuredAt?.toISOString() ?? null,
  device: bodyComposition.device,
  body_fat_percent: bodyComposition.bodyFatPercent,
  muscle_mass_kg: bodyComposition.muscleMassKg,
  skeletal_muscle_percent: bodyComposition.skeletalMusclePercent,
  created_at: bodyComposition.createdAt.toISOString(),
  updated_at: bodyComposition.updatedAt.toISOString(),
})

export const buildWeightOutlookPayload = (outlook: WeightOutlook) => ({
  as_of: outlook.asOf,
  points: outlook.points.map((point) => ({
    date: point.date,
    weight_kg: point.weightKg,
  })),
  latest_weight_kg: outlook.latestWeightKg,
  goal_weight_kg: outlook.goalWeightKg,
  trend:
    outlook.trend === null
      ? null
      : {
          slope_kg_per_day: outlook.trend.slopeKgPerDay,
          slope_kg_per_week: outlook.trend.slopeKgPerWeek,
          points: outlook.trend.points.map((point) => ({
            date: point.date,
            weight_kg: point.weightKg,
            lower_kg: point.lowerKg,
            upper_kg: point.upperKg,
          })),
        },
  status: outlook.status,
  reason: outlook.reason,
  arrival_date_range:
    outlook.arrivalDateRange === null
      ? null
      : {
          from: outlook.arrivalDateRange.from,
          to: outlook.arrivalDateRange.to,
        },
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

export const buildDeliveryItemPayload = (item: DeliveryItem) => ({
  food_master_id: item.foodMasterId,
  food_name: item.foodName,
  quantity: item.quantity,
})

export const buildDeliveryPayload = (delivery: Delivery) => ({
  delivery_id: delivery.id,
  source_ref: delivery.sourceRef,
  status: delivery.status,
  expected_date: delivery.expectedDate,
  received_date: delivery.receivedDate,
  change_deadline: delivery.changeDeadline,
  items: delivery.items.map(buildDeliveryItemPayload),
})

export const buildListedDeliveryPayload = (delivery: ListedDelivery) => ({
  delivery_id: delivery.id,
  source_ref: delivery.sourceRef,
  source_ref_history: delivery.sourceRefHistory.map((entry) => ({
    source_ref: entry.sourceRef,
    created_at: entry.createdAt,
  })),
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
})

export const buildMealSetPayload = (
  mealSet: MealSet,
): Record<string, unknown> => ({
  meal_set_id: mealSet.id,
  name: mealSet.name,
  items: mealSet.items.map((item) => ({
    food_master_id: item.foodMasterId,
    food_name: item.foodName,
    quantity: item.quantity,
  })),
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
