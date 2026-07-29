import type { MealType } from '#api/day-detail'

// time is a JST wall-clock HH:MM string (the meal log sheet's time input),
// mirroring src/domain/meal-log/infer-meal-type.ts's JST-hour boundaries.
export const inferMealType = (time: string): MealType => {
  const hour = Number(time.slice(0, 2))
  if (hour >= 4 && hour < 11) return 'breakfast'
  if (hour >= 11 && hour < 16) return 'lunch'
  if (hour >= 16 && hour < 23) return 'dinner'
  return 'snack'
}
