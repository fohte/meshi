export interface MealSetItemInput {
  readonly foodMasterId: string
  // Multiplier against one unit of the food_master, matching meal_logs.quantity.
  readonly quantity: number
}

export interface MealSetItem extends MealSetItemInput {
  readonly foodName: string
}

export interface MealSet {
  readonly id: string
  readonly name: string
  readonly items: ReadonlyArray<MealSetItem>
  readonly createdAt: Date
}

export interface RegisterMealSetInput {
  readonly name: string
  readonly items: ReadonlyArray<MealSetItemInput>
}

export interface UpdateMealSetInput extends RegisterMealSetInput {
  readonly id: string
}
