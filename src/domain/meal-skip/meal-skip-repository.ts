import type { ResultAsync } from 'neverthrow'

import type { DomainError } from '#domain/meal-skip/errors'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'

export interface InsertMealSkipInput {
  readonly id: string
  readonly date: string
  readonly mealType: MealType
}

export interface MealSkipRepository {
  recordSkip(input: InsertMealSkipInput): ResultAsync<MealSkipRow, DomainError>
  // Resolves to false when no row matched, rather than an error — the
  // service layer decides whether a no-op cancel is a MealSkipNotFoundError.
  cancelSkip(
    date: string,
    mealType: MealType,
  ): ResultAsync<boolean, DomainError>
  findSkipsForDate(
    date: string,
  ): ResultAsync<ReadonlyArray<MealSkipRow>, DomainError>
}
