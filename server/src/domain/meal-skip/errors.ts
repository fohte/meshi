import { CodedDomainError } from '#domain/errors'
import type { JstDate } from '#lib/jst-date'

export type MealSkipErrorCode =
  | 'meal_skip/invalid_date'
  | 'meal_skip/future_date'
  | 'meal_skip/not_found'
  | 'meal_skip/persistence_failed'

export class MealSkipDomainError extends CodedDomainError<MealSkipErrorCode> {
  constructor(
    code: MealSkipErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'MealSkipDomainError'
  }
}

export class InvalidMealSkipDateError extends MealSkipDomainError {
  constructor(public readonly date: JstDate) {
    super(
      'meal_skip/invalid_date',
      `date must be a valid YYYY-MM-DD JST calendar date: ${date}`,
      { date },
    )
    this.name = 'InvalidMealSkipDateError'
  }
}

export class FutureMealSkipDateError extends MealSkipDomainError {
  constructor(public readonly date: JstDate) {
    super('meal_skip/future_date', `date must not be in the future: ${date}`, {
      date,
    })
    this.name = 'FutureMealSkipDateError'
  }
}

export class MealSkipNotFoundError extends MealSkipDomainError {
  constructor(
    public readonly date: JstDate,
    public readonly mealType: string,
  ) {
    super('meal_skip/not_found', `meal_skip not found: ${date} ${mealType}`, {
      date,
      mealType,
    })
    this.name = 'MealSkipNotFoundError'
  }
}

export class MealSkipPersistenceError extends MealSkipDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_skip/persistence_failed', message, {}, cause)
    this.name = 'MealSkipPersistenceError'
  }
}
