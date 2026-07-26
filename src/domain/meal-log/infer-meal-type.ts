import type { MealType } from '@/domain/meal-log/types'

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

// Asia/Tokyo has no DST, so shifting the UTC instant by a fixed +9h and
// reading its UTC hour gives the exact JST wall-clock hour.
export const inferMealType = (eatenAt: Date): MealType => {
  const jstHour = new Date(eatenAt.getTime() + JST_OFFSET_MS).getUTCHours()
  if (jstHour >= 4 && jstHour < 11) return 'breakfast'
  if (jstHour >= 11 && jstHour < 16) return 'lunch'
  if (jstHour >= 16 && jstHour < 23) return 'dinner'
  return 'snack'
}
