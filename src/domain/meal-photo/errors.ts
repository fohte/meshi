import { CodedDomainError } from '#domain/errors'
import type { JstDate } from '#lib/jst-date'

export type MealPhotoErrorCode =
  | 'meal_photo/invalid_date'
  | 'meal_photo/not_found'
  | 'meal_photo/persistence_failed'
  | 'meal_photo/storage_failed'
  | 'meal_photo/consistency_failed'

export class MealPhotoDomainError extends CodedDomainError<MealPhotoErrorCode> {
  constructor(
    code: MealPhotoErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'MealPhotoDomainError'
  }
}

export class InvalidMealPhotoDateError extends MealPhotoDomainError {
  constructor(public readonly date: JstDate) {
    super(
      'meal_photo/invalid_date',
      `date must be a valid YYYY-MM-DD JST calendar date: ${date}`,
      { date },
    )
    this.name = 'InvalidMealPhotoDateError'
  }
}

export class MealPhotoNotFoundError extends MealPhotoDomainError {
  constructor(public readonly id: string) {
    super('meal_photo/not_found', `meal_photo not found: ${id}`, { id })
    this.name = 'MealPhotoNotFoundError'
  }
}

export class MealPhotoPersistenceError extends MealPhotoDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_photo/persistence_failed', message, {}, cause)
    this.name = 'MealPhotoPersistenceError'
  }
}

export class MealPhotoStorageError extends MealPhotoDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_photo/storage_failed', message, {}, cause)
    this.name = 'MealPhotoStorageError'
  }
}

export class MealPhotoConsistencyError extends MealPhotoDomainError {
  constructor(message: string, cause?: unknown) {
    super('meal_photo/consistency_failed', message, {}, cause)
    this.name = 'MealPhotoConsistencyError'
  }
}
