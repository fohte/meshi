import type { ResultAsync } from 'neverthrow'

import type { NutritionMap } from '#domain/meal-history/types'
import type { MealType } from '#domain/meal-log/types'
import type { JstDate } from '#lib/jst-date'

export interface DayDetailEntry {
  readonly id: string
  readonly foodMasterId: string
  readonly foodName: string
  readonly eatenDate: JstDate
  readonly mealType: MealType
  readonly quantity: number
  readonly unit: string
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
  readonly date: JstDate
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
