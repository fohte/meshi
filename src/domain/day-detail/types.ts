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
}

export interface QueryDayDetailInput {
  readonly periodFrom: Date
  readonly periodTo: Date
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
