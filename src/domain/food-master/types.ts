export type FoodSource =
  'web_search' | 'composition_table_estimate' | 'user_input'

export type NutrientCode = string

export type NutritionMap = Readonly<Record<NutrientCode, number>>

export type FoodMasterId = string

export interface FoodMasterUnitDefinition {
  readonly unit: string
  readonly gramsPerUnit: number
}

export interface FoodMaster {
  readonly id: FoodMasterId
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly isEstimated: boolean
  readonly source: FoodSource
  readonly sourceUrl: string | null
  readonly nutrition: NutritionMap
  readonly units: ReadonlyArray<FoodMasterUnitDefinition>
  readonly createdAt: Date
}

export interface RegisterFoodMasterInput {
  readonly name: string
  readonly aliases?: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl?: string
  // Per-serving mass for non-mass units (個/杯/ml/...) this food may be
  // recorded with; g/kg/mg need no entry here — see resolveAmountGrams.
  readonly units?: ReadonlyArray<FoodMasterUnitDefinition>
}
