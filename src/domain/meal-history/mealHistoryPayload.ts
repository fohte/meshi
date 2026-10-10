import type { NutritionStatus } from '#domain/food-master/types'
import type { MealHistoryAggregate } from '#domain/meal-history/types'
import type { MealType } from '#domain/meal-log/types'

interface MealHistoryPayloadEntry {
  readonly meal_log_id: string
  readonly food_master_id: string
  readonly food_name: string
  readonly eaten_date: string
  readonly meal_type: MealType
  readonly quantity: number
  readonly nutrition_status: NutritionStatus
}

interface MealHistoryPayloadBase {
  readonly totals: Record<string, number>
  readonly per_day: Array<{
    readonly date: string
    readonly totals: Record<string, number>
    readonly has_unknown_values: boolean
  }>
  readonly entries: Array<MealHistoryPayloadEntry>
  readonly has_estimated_values: boolean
  readonly has_unknown_values: boolean
}

interface MealHistoryPayloadWithRecordedAt extends Omit<
  MealHistoryPayloadBase,
  'entries'
> {
  readonly entries: Array<
    MealHistoryPayloadEntry & { readonly recorded_at: string }
  >
}

export function toMealHistoryPayload(
  aggregate: MealHistoryAggregate,
): MealHistoryPayloadBase
export function toMealHistoryPayload(
  aggregate: MealHistoryAggregate,
  options: { readonly includeRecordedAt: true },
): MealHistoryPayloadWithRecordedAt
export function toMealHistoryPayload(
  aggregate: MealHistoryAggregate,
  options: { readonly includeRecordedAt: boolean } = {
    includeRecordedAt: false,
  },
): MealHistoryPayloadBase | MealHistoryPayloadWithRecordedAt {
  return {
    totals: { ...aggregate.totals },
    per_day: aggregate.perDay.map((day) => ({
      date: day.date,
      totals: { ...day.totals },
      has_unknown_values: day.hasUnknownValues,
    })),
    entries: aggregate.entries.map((entry) => ({
      meal_log_id: entry.id,
      food_master_id: entry.foodMasterId,
      food_name: entry.foodName,
      eaten_date: entry.eatenDate,
      meal_type: entry.mealType,
      quantity: entry.quantity,
      nutrition_status: entry.nutritionStatus,
      ...(options.includeRecordedAt ? { recorded_at: entry.recordedAt } : {}),
    })),
    has_estimated_values: aggregate.hasEstimatedValues,
    has_unknown_values: aggregate.hasUnknownValues,
  }
}
