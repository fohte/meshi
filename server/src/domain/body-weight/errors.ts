import { CodedDomainError } from '#domain/errors'

export type BodyWeightErrorCode =
  | 'body_weight/invalid_date'
  | 'body_weight/future_date'
  | 'body_weight/measured_at_date_mismatch'
  | 'body_weight/invalid_weight'
  | 'body_weight/duplicate'
  | 'body_weight/not_found'
  | 'body_weight/persistence_failed'

export class BodyWeightDomainError extends CodedDomainError<BodyWeightErrorCode> {
  constructor(
    code: BodyWeightErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'BodyWeightDomainError'
  }
}

export class InvalidBodyWeightDateError extends BodyWeightDomainError {
  constructor(date: string) {
    super('body_weight/invalid_date', `invalid body weight date: ${date}`, {
      date,
    })
    this.name = 'InvalidBodyWeightDateError'
  }
}

export class FutureBodyWeightDateError extends BodyWeightDomainError {
  constructor(date: string) {
    super(
      'body_weight/future_date',
      `body weight date is in the future: ${date}`,
      {
        date,
      },
    )
    this.name = 'FutureBodyWeightDateError'
  }
}

export class BodyWeightMeasuredAtDateMismatchError extends BodyWeightDomainError {
  constructor(date: string, measuredAt: Date) {
    super(
      'body_weight/measured_at_date_mismatch',
      'measuredAt must fall on the body weight date in JST',
      { date, measuredAt: measuredAt.toISOString() },
    )
    this.name = 'BodyWeightMeasuredAtDateMismatchError'
  }
}

export class InvalidBodyWeightValueError extends BodyWeightDomainError {
  constructor(weightKg: number) {
    super(
      'body_weight/invalid_weight',
      `weightKg must be between 20 and 300 kg with at most 2 decimal places: ${String(weightKg)}`,
      { weightKg },
    )
    this.name = 'InvalidBodyWeightValueError'
  }
}

export class DuplicateBodyWeightError extends BodyWeightDomainError {
  constructor(cause?: unknown) {
    super(
      'body_weight/duplicate',
      'body weight conflicts with another measurement',
      {},
      cause,
    )
    this.name = 'DuplicateBodyWeightError'
  }
}

export class BodyWeightNotFoundError extends BodyWeightDomainError {
  constructor(id: string) {
    super('body_weight/not_found', `body weight not found: ${id}`, { id })
    this.name = 'BodyWeightNotFoundError'
  }
}

export class BodyWeightPersistenceError extends BodyWeightDomainError {
  constructor(message: string, cause?: unknown) {
    super('body_weight/persistence_failed', message, {}, cause)
    this.name = 'BodyWeightPersistenceError'
  }
}
