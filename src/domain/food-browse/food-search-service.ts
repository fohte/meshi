import { drizzle } from 'drizzle-orm/postgres-js'
import type { ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { loadFoodMasterEnrichment } from '#domain/food-browse/food-enrichment'
import type {
  FoodMatchCandidate,
  FoodMatcher,
  FoodMatcherError,
} from '#domain/food-matcher/food-matcher'

export interface RegisteredFoodSearchResult {
  readonly foodMasterId: string
  readonly name: string
  readonly isEstimated: boolean
  readonly energyKcalPerUnit: number | null
}

export class FoodSearchQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodSearchQueryError'
  }
}

export interface FoodSearchService {
  searchRegistered(
    queries: ReadonlyArray<string>,
    limit: number,
  ): ResultAsync<
    ReadonlyArray<RegisteredFoodSearchResult>,
    FoodSearchQueryError | FoodMatcherError
  >
}

const isRegisteredFood = (
  candidate: FoodMatchCandidate,
): candidate is FoodMatchCandidate & { readonly foodMasterId: string } =>
  candidate.foodMasterId !== null

export const createFoodSearchService = (
  sql: Sql,
  foodMatcher: FoodMatcher,
): FoodSearchService => {
  const db = drizzle(sql)

  return {
    searchRegistered: (queries, limit) =>
      foodMatcher
        .search({ queries, limit, origin: 'retail' })
        .andThen((candidates) => {
          const registered = candidates.filter(isRegisteredFood)
          return loadFoodMasterEnrichment(
            db,
            registered.map((candidate) => candidate.foodMasterId),
          )
            .mapErr(
              (caughtErr) =>
                new FoodSearchQueryError(
                  'failed to enrich food search results',
                  caughtErr,
                ),
            )
            .map((enrichment) =>
              registered.map((candidate) => ({
                foodMasterId: candidate.foodMasterId,
                name: candidate.name,
                isEstimated: candidate.isEstimated,
                energyKcalPerUnit:
                  enrichment.get(candidate.foodMasterId)?.energyKcalPerUnit ??
                  null,
              })),
            )
        }),
  }
}
