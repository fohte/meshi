import type { DayDetailEntry, MealType } from '#api/day-detail'
import { formatJstTime } from '#lib/jst-date'

const MEAL_ORDER: ReadonlyArray<MealType> = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]
const MEAL_LABELS: Record<MealType, string> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
}

export interface MealTimelineItem {
  readonly id: string
  readonly time: string
  readonly name: string
  readonly isEstimated: boolean
  readonly quantityText: string
  readonly kcalText: string
}

export type MealGroupStatus = 'eaten' | 'skipped' | 'unrecorded'

export interface MealTimelineGroup {
  readonly mealType: MealType
  readonly label: string
  readonly status: MealGroupStatus
  readonly kcalText: string | null
  readonly items: ReadonlyArray<MealTimelineItem>
}

const formatQuantity = (quantity: number): string =>
  Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1)

// Entries arrive pre-sorted by eatenAt from the API, so items within each
// group stay time-ordered without a separate sort here.
//
// Always returns one group per MEAL_ORDER entry (never dropping empty ones)
// so "no entries recorded" (unrecorded) is distinguishable from "recorded as
// skipped" in the rendered output.
export const buildMealTimelineGroups = (
  entries: ReadonlyArray<DayDetailEntry>,
  skippedMealTypes: ReadonlyArray<MealType>,
): ReadonlyArray<MealTimelineGroup> => {
  const skipped = new Set(skippedMealTypes)
  return MEAL_ORDER.map((mealType) => {
    const items = entries.filter((entry) => entry.mealType === mealType)
    if (items.length > 0) {
      const kcalTotal = items.reduce((sum, entry) => sum + entry.kcal, 0)
      return {
        mealType,
        label: MEAL_LABELS[mealType],
        status: 'eaten' as const,
        kcalText: `${String(Math.round(kcalTotal))} kcal`,
        items: items.map((entry) => ({
          id: entry.id,
          time: formatJstTime(entry.eatenAt),
          name: entry.foodName,
          isEstimated: entry.isEstimated,
          quantityText: `${formatQuantity(entry.quantity)} ${entry.unit}`,
          kcalText: `${String(Math.round(entry.kcal))} kcal`,
        })),
      }
    }
    return {
      mealType,
      label: MEAL_LABELS[mealType],
      status: skipped.has(mealType)
        ? ('skipped' as const)
        : ('unrecorded' as const),
      kcalText: null,
      items: [],
    }
  })
}
