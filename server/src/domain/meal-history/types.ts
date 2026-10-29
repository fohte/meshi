import type { ResultAsync } from 'neverthrow'

import type { FoodSource, NutritionStatus } from '#domain/food-master/types'
import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export type NutrientCode = string

export type NutritionMap = Readonly<Record<NutrientCode, number>>

export const NUTRITION_VERSION_CHANGE_KINDS = [
  'initial',
  'product_update',
  'correction',
] as const

type NutritionVersionChangeKind =
  (typeof NUTRITION_VERSION_CHANGE_KINDS)[number]

export const NUTRITION_VERSION_ORIGINS = [
  'recorded',
  'migrated',
  'filled',
  'reassigned',
] as const

export type NutritionVersionOrigin = (typeof NUTRITION_VERSION_ORIGINS)[number]

export interface MealHistoryNutritionVersion {
  readonly versionNo: number
  readonly changeKind: NutritionVersionChangeKind
  readonly source: FoodSource
  readonly isEstimated: boolean
  readonly checkedOn: string | null
  readonly effectiveFrom: string | null
}

interface QueryMealHistoryInput {
  // JST calendar date (see src/lib/jst-date.ts), inclusive.
  readonly periodFrom: JstDate
  // JST calendar date, exclusive — the period is the half-open range
  // [periodFrom, periodTo).
  readonly periodTo: JstDate
  readonly foodFilter?: ReadonlyArray<string>
  readonly nutrientCodes?: ReadonlyArray<NutrientCode>
}

export interface MealLogEntry {
  readonly id: string
  readonly foodMasterId: string
  readonly foodName: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  readonly quantity: number
  readonly recordedAt: string
  readonly nutritionStatus: NutritionStatus
  readonly nutritionVersion: MealHistoryNutritionVersion | null
  readonly nutritionVersionOrigin: NutritionVersionOrigin
  readonly nutritionVersionDifferences: ReadonlyArray<MealHistoryNutritionVersion>
}

export interface MealHistoryDayTotals {
  readonly date: JstDate
  readonly totals: NutritionMap
  readonly incompleteNutrients: ReadonlyArray<NutrientCode>
  readonly hasUnknownValues: boolean
}

export interface MealHistoryAggregate {
  readonly totals: NutritionMap
  readonly incompleteNutrients: ReadonlyArray<NutrientCode>
  readonly perDay: ReadonlyArray<MealHistoryDayTotals>
  readonly entries: ReadonlyArray<MealLogEntry>
  readonly hasEstimatedValues: boolean
  readonly hasUnknownValues: boolean
}

export class MealHistoryQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'MealHistoryQueryError'
  }
}

export interface MealHistoryService {
  query(
    input: QueryMealHistoryInput,
  ): ResultAsync<MealHistoryAggregate, MealHistoryQueryError>
}
