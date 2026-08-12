export type FoodSource =
  'web_search' | 'composition_table_estimate' | 'user_input'

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
  readonly sourceCompositionCode: string | null
  // Nutrition per one of this food_master — meal_logs.quantity is a bare
  // multiplier against these values, see meal-log-service.ts.
  readonly nutrition: NutritionMap
  readonly createdAt: Date
}

export interface SimilarFoodMasterCandidate {
  readonly foodMasterId: FoodMasterId
  readonly name: string
  readonly score: number
}

// Same shape for a dry-run plan and an applied merge — `applied` is the only
// discriminator, so a caller can preview a merge and later apply it while
// rendering the result the same way both times. On any conflict the
// survivor's data always wins: `discardedNutrition` is the loser's entire
// nutrition — nutrients are never moved, only ever discarded via the loser
// row's ON DELETE CASCADE.
export interface MergeFoodMasterResult {
  readonly survivorId: FoodMasterId
  readonly loserId: FoodMasterId
  readonly applied: boolean
  readonly movedAliases: ReadonlyArray<string>
  // The loser's own name, added as an alias on the survivor so old
  // references to it still resolve — null when that exact string is already
  // an alias elsewhere (INSERT ... ON CONFLICT (alias) DO NOTHING no-ops).
  readonly nameMovedAsAlias: string | null
  readonly discardedNutrition: NutritionMap
  readonly movedMealLogCount: number
}

export interface RegisterFoodMasterInput {
  readonly name: string
  readonly aliases?: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly sourceUrl?: string
  readonly sourceCompositionCode?: string
}
