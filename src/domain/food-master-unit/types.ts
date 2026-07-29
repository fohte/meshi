export interface FoodMasterUnit {
  readonly foodMasterId: string
  readonly unit: string
  readonly gramsPerUnit: number
}

export interface RegisterFoodMasterUnitInput {
  readonly foodMasterId: string
  readonly unit: string
  readonly gramsPerUnit: number
}
