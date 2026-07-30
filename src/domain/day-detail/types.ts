import type { ResultAsync } from 'neverthrow'

import type { NutritionMap } from '#domain/meal-history/types'
import type { MealType } from '#domain/meal-log/types'

export interface DayDetailEntry {
  readonly id: string
  readonly foodMasterId: string
  readonly foodName: string
  readonly eatenAt: Date
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
  readonly note: string | null
  readonly kcal: number
  readonly isEstimated: boolean
}

export interface DayDetail {
  readonly totals: NutritionMap
  readonly hasEstimatedValues: boolean
  readonly entries: ReadonlyArray<DayDetailEntry>
  readonly skippedMealTypes: ReadonlyArray<MealType>
}

export interface QueryDayDetailInput {
  readonly periodFrom: Date
  readonly periodTo: Date
  // The JST calendar date (see src/lib/jst-date.ts),
  // separate from periodFrom/periodTo's UTC instant range — meal_skips key
  // off this exact string.
  readonly date: string
}

export class DayDetailQueryError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'DayDetailQueryError'
  }
}

export interface DayDetailService {
  query(input: QueryDayDetailInput): ResultAsync<DayDetail, DayDetailQueryError>
}
