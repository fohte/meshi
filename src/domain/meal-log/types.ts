import type { JstDate } from '#lib/jst-date'

export type NutritionMap = Readonly<Record<string, number>>

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealType = (typeof MEAL_TYPES)[number]

export interface FoodMasterRef {
  readonly id: string
  readonly name: string
  readonly isEstimated: boolean
  // Nutrition per one of this food_master — see scaleNutrition.
  readonly nutritionPerUnit: NutritionMap
}

export interface MealLogRow {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  // Multiplier against the food_master's own nutritionPerUnit.
  readonly quantity: number
  readonly createdAt: Date
}

export interface RecordMealLogInput {
  readonly foodMasterId: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  readonly quantity: number
  // The caller's expected name for foodMasterId, checked against the actual
  // food_master row before the write (see FoodNameMismatchError). Optional so
  // callers that already resolve food_master_id from a UI the user directly
  // confirmed (e.g. the web registration sheet) aren't forced to supply it.
  readonly foodName?: string
}

export interface UpdateMealLogInput {
  readonly id: string
  readonly foodMasterId?: string
  readonly eatenDate?: JstDate
  readonly mealType?: MealType
  readonly quantity?: number
}

export interface MealLogResult extends MealLogRow {
  readonly nutrition: NutritionMap
  readonly isEstimated: boolean
}
