export type FoodMatchReason =
  'history_recent' | 'history_frequent' | 'fuzzy_name' | 'composition_table'

export interface FoodMatchCandidate {
  readonly reason: FoodMatchReason
  readonly score: number
  // Set when the candidate references an existing food_masters row
  // (history_recent / history_frequent / fuzzy_name).
  readonly foodMasterId: string | null
  // Set when the candidate is a fallback suggestion from food_compositions
  // (composition_table). The orchestrator turns this into a register call.
  readonly compositionCode: string | null
  readonly name: string
  readonly isEstimated: boolean
}

export interface SearchFoodInput {
  readonly query: string
  readonly limit: number
}

export interface FoodMatcher {
  search(input: SearchFoodInput): Promise<ReadonlyArray<FoodMatchCandidate>>
}
