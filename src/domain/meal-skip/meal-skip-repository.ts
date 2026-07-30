import type { ResultAsync } from 'neverthrow'

import type { MealSkipDomainError } from '#domain/meal-skip/errors'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'

export interface InsertMealSkipInput {
  readonly id: string
  readonly date: string
  readonly mealType: MealType
}

export interface MealSkipRepository {
  recordSkip(
    input: InsertMealSkipInput,
  ): ResultAsync<MealSkipRow, MealSkipDomainError>
  // Resolves to false when no row matched, rather than an error — the
  // service layer decides whether a no-op cancel is a MealSkipNotFoundError.
  cancelSkip(
    date: string,
    mealType: MealType,
  ): ResultAsync<boolean, MealSkipDomainError>
  findSkipsForDate(
    date: string,
  ): ResultAsync<ReadonlyArray<MealSkipRow>, MealSkipDomainError>
}
