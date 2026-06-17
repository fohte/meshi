export type FoodSource =
  | 'web_search'
  | 'composition_table_estimate'
  | 'user_input'

export type NutrientCode = string

export type NutritionMap = Readonly<Record<NutrientCode, number>>

export type FoodMasterId = string

export interface FoodMaster {
  readonly id: FoodMasterId
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly isEstimated: boolean
  readonly source: FoodSource
  readonly sourceUrl: string | null
  readonly nutrition: NutritionMap
  readonly createdAt: Date
}

export interface RegisterFoodMasterInput {
  readonly name: string
  readonly aliases?: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl?: string
}
