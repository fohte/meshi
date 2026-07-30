export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

export class InvalidMealSkipDateError extends DomainError {
  constructor(public readonly date: string) {
    super(
      `date must be a valid YYYY-MM-DD JST calendar date: ${date}`,
      'meal_skip/invalid_date',
    )
    this.name = 'InvalidMealSkipDateError'
  }
}

export class FutureMealSkipDateError extends DomainError {
  constructor(public readonly date: string) {
    super(`date must not be in the future: ${date}`, 'meal_skip/future_date')
    this.name = 'FutureMealSkipDateError'
  }
}

export class MealSkipNotFoundError extends DomainError {
  constructor(
    public readonly date: string,
    public readonly mealType: string,
  ) {
    super(`meal_skip not found: ${date} ${mealType}`, 'meal_skip/not_found')
    this.name = 'MealSkipNotFoundError'
  }
}

export class MealSkipPersistenceError extends DomainError {
  constructor(message: string, cause?: unknown) {
    super(message, 'meal_skip/persistence_failed')
    this.name = 'MealSkipPersistenceError'
    if (cause !== undefined) this.cause = cause
  }
}
