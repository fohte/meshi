import type { DayDetailEntry, MealType } from '#api/day-detail'
import type { SaveMealSetInput } from '#api/meal-sets'

export const buildDayMealSetInput = (
  entries: ReadonlyArray<DayDetailEntry>,
  mealType: MealType,
  name: string,
): SaveMealSetInput => {
  const quantitiesByFoodMasterId = new Map<string, number>()

  for (const entry of entries) {
    if (entry.mealType !== mealType) continue
    quantitiesByFoodMasterId.set(
      entry.foodMasterId,
      (quantitiesByFoodMasterId.get(entry.foodMasterId) ?? 0) + entry.quantity,
    )
  }

  return {
    name,
    items: Array.from(quantitiesByFoodMasterId, ([foodMasterId, quantity]) => ({
      foodMasterId,
      quantity,
    })),
  }
}
