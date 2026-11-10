import type { DayDetailEntry, MealType } from '#api/day-detail'
import type { MealPlan } from '#api/meal-plans'

const MEAL_ORDER: ReadonlyArray<MealType> = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
]
export const MEAL_LABELS: Readonly<Record<MealType, string>> = {
  breakfast: '朝食',
  lunch: '昼食',
  dinner: '夕食',
  snack: '間食',
}

interface MealTimelineItem {
  readonly id: string
  readonly name: string
  readonly isEstimated: boolean
  readonly isUnknown: boolean
  readonly hasNutritionVersionDifferences: boolean
  readonly quantityText: string
  readonly kcalText: string
}

type MealGroupStatus = 'eaten' | 'skipped' | 'planned' | 'unrecorded'

export interface MealTimelineGroup {
  readonly mealType: MealType
  readonly label: string
  readonly status: MealGroupStatus
  readonly kcalText: string | null
  readonly items: ReadonlyArray<MealTimelineItem>
  readonly plan?: MealPlan
}

const formatQuantity = (quantity: number): string =>
  Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(1)

// Entries arrive pre-sorted by eatenDate + createdAt (insertion order) from
// the API, so items within each group stay in that order without a separate
// sort here.
//
// Always returns one group per MEAL_ORDER entry (never dropping empty ones)
// so "no entries recorded" (unrecorded) is distinguishable from "recorded as
// skipped" in the rendered output.
export const buildMealTimelineGroups = (
  entries: ReadonlyArray<DayDetailEntry>,
  skippedMealTypes: ReadonlyArray<MealType>,
  mealPlans: ReadonlyArray<MealPlan> = [],
): ReadonlyArray<MealTimelineGroup> => {
  const skipped = new Set(skippedMealTypes)
  return MEAL_ORDER.map((mealType) => {
    const items = entries.filter((entry) => entry.mealType === mealType)
    if (items.length > 0) {
      const hasUnknownValues = items.some(
        (entry) => entry.nutritionStatus === 'unknown' || entry.kcal === null,
      )
      const kcalTotal = items.reduce((sum, entry) => sum + (entry.kcal ?? 0), 0)
      return {
        mealType,
        label: MEAL_LABELS[mealType],
        status: 'eaten' as const,
        kcalText: hasUnknownValues
          ? '不明'
          : `${String(Math.round(kcalTotal))} kcal`,
        items: items.map((entry) => {
          const isUnknown =
            entry.nutritionStatus === 'unknown' || entry.kcal === null
          return {
            id: entry.id,
            name: entry.foodName,
            isEstimated: entry.isEstimated,
            isUnknown,
            hasNutritionVersionDifferences:
              entry.nutritionVersionDifferences.length > 0,
            quantityText: `×${formatQuantity(entry.quantity)}`,
            kcalText: isUnknown
              ? '不明'
              : `${String(Math.round(entry.kcal ?? 0))} kcal`,
          }
        }),
      }
    }
    if (skipped.has(mealType)) {
      return {
        mealType,
        label: MEAL_LABELS[mealType],
        status: 'skipped' as const,
        kcalText: null,
        items: [],
      }
    }
    const plan = mealPlans.find(
      (mealPlan) =>
        mealPlan.mealType === mealType && mealPlan.status === 'planned',
    )
    if (plan !== undefined) {
      return {
        mealType,
        label: MEAL_LABELS[mealType],
        status: 'planned' as const,
        kcalText: null,
        items: plan.items.map((item, index) => {
          const kcal =
            item.energyKcalPerUnit === null
              ? null
              : item.energyKcalPerUnit * item.quantity
          return {
            id: plan.id + '-' + String(index),
            name: item.foodName,
            isEstimated: false,
            isUnknown: item.energyKcalPerUnit === null,
            hasNutritionVersionDifferences: false,
            quantityText: '×' + formatQuantity(item.quantity),
            kcalText:
              kcal === null ? '不明' : String(Math.round(kcal)) + ' kcal',
          }
        }),
        plan,
      }
    }
    return {
      mealType,
      label: MEAL_LABELS[mealType],
      status: 'unrecorded' as const,
      kcalText: null,
      items: [],
    }
  })
}
