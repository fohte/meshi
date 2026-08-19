import type { ResultAsync } from 'neverthrow'

import type {
  FoodMatcherInvalidRowError,
  FoodMatcherQueryError,
} from '#domain/food-matcher/drizzle-food-matcher'

export type FoodMatchReason =
  'history_recent' | 'history_frequent' | 'fuzzy_name' | 'composition_table'

// Whether the food being searched for was bought/prepared by someone else
// ('retail' — includes restaurant meals and gifts) or cooked by the user
// ('homemade'). Controls whether food_compositions fallback candidates are
// considered at all: a composition entry names a raw ingredient, not a
// product, so it's only a safe fallback for something assembled from
// ingredients, never for a specific packaged/prepared product.
export type FoodOrigin = 'retail' | 'homemade'

export interface FoodMatchCandidate {
  readonly reason: FoodMatchReason
  readonly score: number
  // Raw trigram name-similarity strength (query vs. the matched name/alias),
  // independent of any history-based bonus baked into `score` — a food
  // eaten before can score >1.0 even when the name barely overlaps with the
  // query. Lets a caller tell a confidently name-matched candidate apart
  // from one that only cleared `score` via history.
  readonly nameSim: number
  // Set when the candidate references an existing food_masters row
  // (history_recent / history_frequent / fuzzy_name).
  readonly foodMasterId: string | null
  // Set when the candidate is a fallback suggestion from food_compositions
  // (composition_table). The orchestrator turns this into a register call.
  readonly compositionCode: string | null
  readonly name: string
  readonly isEstimated: boolean
  // Which of SearchFoodInput.queries matched this candidate (by name or by
  // alias), so a caller juggling several phrasings of the same food can tell
  // which one actually hit.
  readonly matchedQueries: ReadonlyArray<string>
}

export interface SearchFoodInput {
  readonly queries: ReadonlyArray<string>
  readonly limit: number
  readonly origin: FoodOrigin
}

export type FoodMatcherError =
  FoodMatcherInvalidRowError | FoodMatcherQueryError

export interface FoodMatcher {
  search(
    input: SearchFoodInput,
  ): ResultAsync<ReadonlyArray<FoodMatchCandidate>, FoodMatcherError>
}
