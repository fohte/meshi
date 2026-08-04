export type NutritionMap = Readonly<Record<string, number>>

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const

export type MealType = (typeof MEAL_TYPES)[number]

export interface FoodMasterRef {
  readonly id: string
  readonly name: string
  readonly isEstimated: boolean
  readonly nutritionPerBasis: NutritionMap
  // The food's own basis quantity/unit (food_masters.basis_quantity/
  // basis_unit) — nutritionPerBasis is "per basisQuantity basisUnit", not
  // necessarily per 100g. See resolveAmountGrams and scaleNutrition.
  readonly basisQuantity: number
  readonly basisUnit: string
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
  readonly createdAt: Date
}

export interface RecordMealLogInput {
  readonly foodMasterId: string
  readonly eatenAt: Date
  readonly mealType?: MealType
  readonly quantity: number
  readonly unit: string
  // The caller's expected name for foodMasterId, checked against the actual
  // food_master row before the write (see FoodNameMismatchError). Optional so
  // callers that already resolve food_master_id from a UI the user directly
  // confirmed (e.g. the web registration sheet) aren't forced to supply it.
  readonly foodName?: string
}

export interface UpdateMealLogInput {
  readonly id: string
  readonly foodMasterId?: string
  readonly eatenAt?: Date
  readonly mealType?: MealType
  readonly quantity?: number
  readonly unit?: string
}

export interface MealLogResult extends MealLogRow {
  readonly nutrition: NutritionMap
  readonly isEstimated: boolean
}
