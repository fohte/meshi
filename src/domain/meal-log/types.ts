export type NutritionMap = Readonly<Record<string, number>>

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack'

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

export interface MealLogResult extends MealLogRow {
  readonly nutrition: NutritionMap
  readonly isEstimated: boolean
}
