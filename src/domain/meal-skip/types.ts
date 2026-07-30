import type { MealType } from '#domain/meal-log/types'

export type { MealType }

export interface MealSkipRow {
  readonly id: string
  readonly date: string
  readonly mealType: MealType
  readonly createdAt: Date
}
