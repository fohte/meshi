import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export type { MealType }

export interface MealSkipRow {
  readonly id: string
  readonly date: JstDate
  readonly mealType: MealType
  readonly createdAt: Date
}
