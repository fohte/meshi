import { drizzle } from 'drizzle-orm/postgres-js'
import type { ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { loadFoodCompositionEnergy } from '#domain/food-browse/food-composition-enrichment'
import { loadFoodMasterEnrichment } from '#domain/food-browse/food-enrichment'
import type {
  FoodMatchCandidate,
  FoodMatcher,
  FoodMatcherError,
  FoodOrigin,
} from '#domain/food-matcher/food-matcher'

type FoodSearchResult =
  | {
      readonly foodMasterId: string
      readonly compositionCode: null
      readonly name: string
      readonly isEstimated: boolean
      readonly energyKcalPerUnit: number | null
    }
  | {
      readonly foodMasterId: null
      readonly compositionCode: string
      readonly name: string
      readonly isEstimated: boolean
      readonly energyKcalPer100g: number | null
    }

class FoodSearchQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodSearchQueryError'
  }
}

export interface FoodSearchService {
  search(
    queries: ReadonlyArray<string>,
    limit: number,
    origin?: FoodOrigin,
  ): ResultAsync<
    ReadonlyArray<FoodSearchResult>,
    FoodSearchQueryError | FoodMatcherError
  >
}

const isRegisteredFood = (
  candidate: FoodMatchCandidate,
): candidate is FoodMatchCandidate & {
  readonly foodMasterId: string
  readonly compositionCode: null
} => candidate.foodMasterId !== null && candidate.compositionCode === null

const isCompositionFood = (
  candidate: FoodMatchCandidate,
): candidate is FoodMatchCandidate & {
  readonly foodMasterId: null
  readonly compositionCode: string
} => candidate.foodMasterId === null && candidate.compositionCode !== null

export const createFoodSearchService = (
  sql: Sql,
  foodMatcher: FoodMatcher,
): FoodSearchService => {
  const db = drizzle(sql)

  return {
    search: (queries, limit, origin = 'retail') =>
      foodMatcher.search({ queries, limit, origin }).andThen((candidates) => {
        const registered = candidates.filter(isRegisteredFood)
        const compositions = candidates.filter(isCompositionFood)
        return loadFoodMasterEnrichment(
          db,
          registered.map((c) => c.foodMasterId),
        )
          .mapErr(
            (caughtErr) =>
              new FoodSearchQueryError(
                'failed to enrich food search results',
                caughtErr,
              ),
          )
          .andThen((masterEnrichment) =>
            loadFoodCompositionEnergy(
              db,
              compositions.map((candidate) => candidate.compositionCode),
            )
              .mapErr(
                (caughtErr) =>
                  new FoodSearchQueryError(
                    'failed to enrich food search results',
                    caughtErr,
                  ),
              )
              .map((compositionEnrichment) =>
                candidates.flatMap<FoodSearchResult>((candidate) => {
                  if (isRegisteredFood(candidate)) {
                    return [
                      {
                        foodMasterId: candidate.foodMasterId,
                        compositionCode: null,
                        name: candidate.name,
                        isEstimated: candidate.isEstimated,
                        energyKcalPerUnit:
                          masterEnrichment.get(candidate.foodMasterId)
                            ?.energyKcalPerUnit ?? null,
                      },
                    ]
                  }
                  if (isCompositionFood(candidate)) {
                    return [
                      {
                        foodMasterId: null,
                        compositionCode: candidate.compositionCode,
                        name: candidate.name,
                        isEstimated: candidate.isEstimated,
                        energyKcalPer100g:
                          compositionEnrichment.get(
                            candidate.compositionCode,
                          ) ?? null,
                      },
                    ]
                  }
                  return []
                }),
              ),
          )
      }),
  }
}
