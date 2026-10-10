import { drizzle } from 'drizzle-orm/postgres-js'
import { ResultAsync } from 'neverthrow'

import type { Sql } from '#db/index'
import { loadFoodCompositionEnergy } from '#domain/food-browse/food-composition-enrichment'
import { loadFoodMasterEnrichment } from '#domain/food-browse/food-enrichment'
import type { NutritionStatus } from '#domain/food-master/types'
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
      readonly nutritionStatus: NutritionStatus
      readonly energyKcalPerUnit: number | null
    }
  | {
      readonly foodMasterId: null
      readonly compositionCode: string
      readonly name: string
      readonly isEstimated: boolean
      readonly nutritionStatus: NutritionStatus
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

type RegisteredFoodCandidate = FoodMatchCandidate & {
  readonly foodMasterId: string
  readonly compositionCode: null
}

type CompositionFoodCandidate = FoodMatchCandidate & {
  readonly foodMasterId: null
  readonly compositionCode: string
}

const isRegisteredFood = (
  candidate: FoodMatchCandidate,
): candidate is RegisteredFoodCandidate =>
  candidate.foodMasterId !== null && candidate.compositionCode === null

const isCompositionFood = (
  candidate: FoodMatchCandidate,
): candidate is CompositionFoodCandidate =>
  candidate.foodMasterId === null && candidate.compositionCode !== null

type ClassifiedFoodCandidate =
  | {
      readonly kind: 'registered'
      readonly candidate: RegisteredFoodCandidate
    }
  | {
      readonly kind: 'composition'
      readonly candidate: CompositionFoodCandidate
    }

const classifyCandidate = (
  candidate: FoodMatchCandidate,
): ClassifiedFoodCandidate | null => {
  if (isRegisteredFood(candidate)) {
    return { kind: 'registered', candidate }
  }
  if (isCompositionFood(candidate)) {
    return { kind: 'composition', candidate }
  }
  return null
}

const toQueryError = (caughtErr: unknown): FoodSearchQueryError =>
  new FoodSearchQueryError('failed to enrich food search results', caughtErr)

export const createFoodSearchService = (
  sql: Sql,
  foodMatcher: FoodMatcher,
): FoodSearchService => {
  const db = drizzle(sql)

  return {
    search: (queries, limit, origin = 'retail') =>
      foodMatcher.search({ queries, limit, origin }).andThen((candidates) => {
        const classified = candidates.flatMap((candidate) => {
          const result = classifyCandidate(candidate)
          return result === null ? [] : [result]
        })
        const registeredIds = classified
          .filter((candidate) => candidate.kind === 'registered')
          .map((candidate) => candidate.candidate.foodMasterId)
        const compositionCodes = classified
          .filter((candidate) => candidate.kind === 'composition')
          .map((candidate) => candidate.candidate.compositionCode)

        return ResultAsync.combine([
          loadFoodMasterEnrichment(db, registeredIds).mapErr(toQueryError),
          loadFoodCompositionEnergy(db, compositionCodes).mapErr(toQueryError),
        ]).map(([masterEnrichment, compositionEnrichment]) =>
          classified.map((match): FoodSearchResult => {
            if (match.kind === 'registered') {
              return {
                foodMasterId: match.candidate.foodMasterId,
                compositionCode: null,
                name: match.candidate.name,
                isEstimated: match.candidate.isEstimated,
                nutritionStatus:
                  masterEnrichment.get(match.candidate.foodMasterId)
                    ?.nutritionStatus ?? 'unknown',
                energyKcalPerUnit:
                  masterEnrichment.get(match.candidate.foodMasterId)
                    ?.energyKcalPerUnit ?? null,
              }
            }
            return {
              foodMasterId: null,
              compositionCode: match.candidate.compositionCode,
              name: match.candidate.name,
              isEstimated: match.candidate.isEstimated,
              nutritionStatus: 'estimated',
              energyKcalPer100g:
                compositionEnrichment.get(match.candidate.compositionCode) ??
                null,
            }
          }),
        )
      }),
  }
}
