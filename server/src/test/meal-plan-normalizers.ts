import type { MealPlan } from '#domain/meal-plan/types'

export const MEAL_PLAN_CREATED_AT_PLACEHOLDER = new Date(
  '2000-01-01T00:00:00.000Z',
)

export const normalizeMealPlan = (plan: MealPlan, id: string): MealPlan => ({
  ...plan,
  id,
  createdAt: MEAL_PLAN_CREATED_AT_PLACEHOLDER,
})

export const normalizeMealPlans = (
  plans: ReadonlyArray<MealPlan>,
  idPrefix: string,
): ReadonlyArray<MealPlan> => {
  const ids = new Map<string, string>()
  return plans.map((plan) => {
    let normalizedId = ids.get(plan.id)
    if (normalizedId === undefined) {
      normalizedId = `${idPrefix}-${String(ids.size + 1)}`
      ids.set(plan.id, normalizedId)
    }
    return normalizeMealPlan(plan, normalizedId)
  })
}
