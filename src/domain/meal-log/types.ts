export type NutritionMap = Readonly<Record<string, number>>

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealType = (typeof MEAL_TYPES)[number]

export interface FoodMasterRef {
  readonly id: string
  readonly name: string
  readonly isEstimated: boolean
  readonly nutritionPer100g: NutritionMap
  // Food-specific serving definitions (food_master_units), keyed by
  // normalized (trimmed, lowercased) unit. g/kg/mg resolve without needing
  // an entry here — see resolveAmountGrams.
  readonly units: Readonly<Record<string, number>>
}

export interface MealLogRow {
  readonly id: string
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
  // The resolved mass this quantity+unit was converted to at record time —
  // the sole basis for this row's nutrition. See resolveAmountGrams.
  readonly amountGrams: number
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
