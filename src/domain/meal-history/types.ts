import type { ResultAsync } from 'neverthrow'

import type { MealType } from '#domain/meal-log/types'

export type NutrientCode = string

export type NutritionMap = Readonly<Record<NutrientCode, number>>

export interface QueryMealHistoryInput {
  // JST calendar date (see src/lib/jst-date.ts), inclusive.
  readonly periodFrom: string
  // JST calendar date, exclusive — the period is the half-open range
  // [periodFrom, periodTo).
  readonly periodTo: string
  readonly foodFilter?: ReadonlyArray<string>
  readonly nutrientCodes?: ReadonlyArray<NutrientCode>
}

export interface MealLogEntry {
  readonly id: string
  readonly foodMasterId: string
  readonly foodName: string
  readonly eatenDate: string
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
}

export interface MealHistoryDayTotals {
  readonly date: string
  readonly totals: NutritionMap
}

export interface MealHistoryAggregate {
  readonly totals: NutritionMap
  readonly perDay: ReadonlyArray<MealHistoryDayTotals>
  readonly entries: ReadonlyArray<MealLogEntry>
  readonly hasEstimatedValues: boolean
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
