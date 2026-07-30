import { errAsync, okAsync, type ResultAsync } from 'neverthrow'

import {
  FutureMealSkipDateError,
  InvalidMealSkipDateError,
  type MealSkipDomainError,
  MealSkipNotFoundError,
} from '#domain/meal-skip/errors'
import type { MealSkipRepository } from '#domain/meal-skip/meal-skip-repository'
import type { MealSkipRow, MealType } from '#domain/meal-skip/types'
import { isValidJstCalendarDateString, todayJstDateString } from '#lib/jst-date'

export interface RecordMealSkipInput {
  readonly date: string
  readonly mealType: MealType
}

export interface CancelMealSkipInput {
  readonly date: string
  readonly mealType: MealType
}

export interface MealSkipService {
  record(
    input: RecordMealSkipInput,
  ): ResultAsync<MealSkipRow, MealSkipDomainError>
  cancel(input: CancelMealSkipInput): ResultAsync<void, MealSkipDomainError>
  findForDate(
    date: string,
  ): ResultAsync<ReadonlyArray<MealSkipRow>, MealSkipDomainError>
}

export interface MealSkipServiceDeps {
  readonly repository: MealSkipRepository
  readonly idGenerator: () => string
  readonly now: () => Date
}

export const createMealSkipService = (
  deps: MealSkipServiceDeps,
): MealSkipService => ({
  record(input) {
    if (!isValidJstCalendarDateString(input.date)) {
      return errAsync(new InvalidMealSkipDateError(input.date))
    }
    if (input.date > todayJstDateString(deps.now())) {
      return errAsync(new FutureMealSkipDateError(input.date))
    }
    return deps.repository.recordSkip({
      id: deps.idGenerator(),
      date: input.date,
      mealType: input.mealType,
    })
  },
  cancel(input) {
    if (!isValidJstCalendarDateString(input.date)) {
      return errAsync(new InvalidMealSkipDateError(input.date))
    }
    return deps.repository
      .cancelSkip(input.date, input.mealType)
      .andThen((deleted) =>
        deleted
          ? okAsync(undefined)
          : errAsync(new MealSkipNotFoundError(input.date, input.mealType)),
      )
  },
  findForDate(date) {
    return deps.repository.findSkipsForDate(date)
  },
})
