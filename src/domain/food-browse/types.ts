import type { ResultAsync } from 'neverthrow'

import type { FoodSource } from '#domain/food-master/types'
import type {
  FoodMatcherError,
  FoodMatchReason,
} from '#domain/food-matcher/food-matcher'

export interface FoodListItem {
  readonly foodMasterId: string | null
  readonly compositionCode: string | null
  readonly name: string
  readonly isEstimated: boolean
  readonly reason: FoodMatchReason
  // Set only when foodMasterId references an existing food_masters row;
  // composition_table candidates aren't registered yet, so neither is known.
  readonly source: FoodSource | null
  readonly energyKcalPer100g: number | null
}

export class FoodBrowseQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodBrowseQueryError'
  }
}

export type FoodBrowseSearchError = FoodBrowseQueryError | FoodMatcherError

export interface FoodBrowseService {
  // Delegates ranking to the injected FoodMatcher (trigram fuzzy match +
  // history weighting); returns [] for a blank query, same as FoodMatcher.
  search(
    query: string,
    limit: number,
  ): ResultAsync<ReadonlyArray<FoodListItem>, FoodBrowseSearchError>
  // Foods most recently logged, newest first.
  listRecent(
    limit: number,
  ): ResultAsync<ReadonlyArray<FoodListItem>, FoodBrowseQueryError>
  // Foods logged most often, highest count first.
  listFrequent(
    limit: number,
  ): ResultAsync<ReadonlyArray<FoodListItem>, FoodBrowseQueryError>
}
