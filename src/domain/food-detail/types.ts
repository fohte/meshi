import type { ResultAsync } from 'neverthrow'

import type { FoodMasterDomainError } from '#domain/food-master/errors'
import type {
  FoodMasterId,
  FoodSource,
  NutritionMap,
} from '#domain/food-master/types'
import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export interface FoodEatHistoryEntry {
  readonly id: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  readonly quantity: number
}

export interface FoodDetail {
  readonly id: FoodMasterId
  readonly name: string
  readonly isEstimated: boolean
  readonly source: FoodSource
  readonly sourceUrl: string | null
  readonly aliases: ReadonlyArray<string>
  readonly nutrition: NutritionMap
  // Newest first.
  readonly history: ReadonlyArray<FoodEatHistoryEntry>
  readonly totalEatenCount: number
}

export class FoodDetailQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodDetailQueryError'
  }
}

export type FoodDetailError = FoodDetailQueryError | FoodMasterDomainError

export interface FoodDetailService {
  getById(id: FoodMasterId): ResultAsync<FoodDetail | null, FoodDetailError>
}
