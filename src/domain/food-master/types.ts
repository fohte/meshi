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
  readonly sourceCompositionCode: string | null
  readonly nutrition: NutritionMap
  readonly units: ReadonlyArray<FoodMasterUnitDefinition>
  readonly basisQuantity: number
  readonly basisUnit: string
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
// survivor's data always wins: `discardedUnits` is loser units whose unit
// name the survivor already defines (with a possibly different
// gramsPerUnit), and `discardedNutrition` is the loser's entire nutrition —
// nutrients are never moved, only ever discarded via the loser row's
// ON DELETE CASCADE.
export interface MergeFoodMasterResult {
  readonly survivorId: FoodMasterId
  readonly loserId: FoodMasterId
  readonly applied: boolean
  readonly movedAliases: ReadonlyArray<string>
  // The loser's own name, added as an alias on the survivor so old
  // references to it still resolve — null when that exact string is already
  // an alias elsewhere (INSERT ... ON CONFLICT (alias) DO NOTHING no-ops).
  readonly nameMovedAsAlias: string | null
  readonly movedUnits: ReadonlyArray<FoodMasterUnitDefinition>
  readonly discardedUnits: ReadonlyArray<FoodMasterUnitDefinition>
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
  // Per-serving mass for non-mass units (個/杯/ml/...) this food may be
  // recorded with; g/kg/mg need no entry here — see resolveAmountGrams.
  readonly units?: ReadonlyArray<FoodMasterUnitDefinition>
  // Defaults to (100, 'g') when omitted, preserving every existing food's
  // implicit basis. A mass unit (g/kg/mg) collapses to basis_unit='g', and a
  // volume unit (ml/l/cc) collapses to basis_unit='ml', both with
  // basis_quantity scaled accordingly; any other unit is kept as an opaque
  // serving unit — see food-master/repository.ts normalizeAndValidate.
  readonly basisQuantity?: number
  readonly basisUnit?: string
}
