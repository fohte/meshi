export type NutritionMap = Readonly<Record<string, number>>

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealType = (typeof MEAL_TYPES)[number]

export interface FoodMasterRef {
  readonly id: string
  readonly name: string
  readonly isEstimated: boolean
  readonly nutritionPer100g: NutritionMap
}

export interface MealLogRow {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
  readonly createdAt: Date
}

export interface RecordMealLogInput {
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly mealType?: MealType
  readonly quantity: number
  readonly unit: string
  readonly note?: string
}

export interface UpdateMealLogInput {
  readonly id: string
  readonly foodMasterId?: string
  readonly eatenAt?: Date
  readonly mealType?: MealType
  readonly quantity?: number
  readonly unit?: string
  readonly note?: string
}

export interface MealLogResult extends MealLogRow {
  readonly nutrition: NutritionMap
  readonly isEstimated: boolean
}
