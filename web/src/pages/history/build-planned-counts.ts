import type { MealPlan } from '#api/meal-plans'

export const buildPlannedCountByDate = (
  mealPlans: ReadonlyArray<MealPlan>,
  today: string,
): ReadonlyMap<string, number> => {
  const plannedCountByDate = new Map<string, number>()

  for (const mealPlan of mealPlans) {
    if (mealPlan.date <= today || mealPlan.status !== 'planned') continue
    plannedCountByDate.set(
      mealPlan.date,
      (plannedCountByDate.get(mealPlan.date) ?? 0) + 1,
    )
  }

  return plannedCountByDate
}
