import { CodedDomainError } from '#domain/errors'

export type BodyCompositionErrorCode =
  | 'body_composition/invalid_date'
  | 'body_composition/future_date'
  | 'body_composition/measured_at_date_mismatch'
  | 'body_composition/invalid_device'
  | 'body_composition/no_values'
  | 'body_composition/invalid_value'
  | 'body_composition/duplicate'
  | 'body_composition/not_found'
  | 'body_composition/persistence_failed'

export class BodyCompositionDomainError extends CodedDomainError<BodyCompositionErrorCode> {
  constructor(
    code: BodyCompositionErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'BodyCompositionDomainError'
  }
}

export class InvalidBodyCompositionDateError extends BodyCompositionDomainError {
  constructor(date: string) {
    super(
      'body_composition/invalid_date',
      `invalid body composition date: ${date}`,
      { date },
    )
    this.name = 'InvalidBodyCompositionDateError'
  }
}

export class FutureBodyCompositionDateError extends BodyCompositionDomainError {
  constructor(date: string) {
    super(
      'body_composition/future_date',
      `body composition date is in the future: ${date}`,
      { date },
    )
    this.name = 'FutureBodyCompositionDateError'
  }
}

export class FutureBodyCompositionMeasurementError extends BodyCompositionDomainError {
  constructor(measuredAt: Date) {
    super(
      'body_composition/future_date',
      'measuredAt must not be in the future',
      {
        measuredAt: measuredAt.toISOString(),
      },
    )
    this.name = 'FutureBodyCompositionMeasurementError'
  }
}

export class BodyCompositionMeasuredAtDateMismatchError extends BodyCompositionDomainError {
  constructor(date: string, measuredAt: Date) {
    super(
      'body_composition/measured_at_date_mismatch',
      'measuredAt must fall on the body composition date in JST',
      { date, measuredAt: measuredAt.toISOString() },
    )
    this.name = 'BodyCompositionMeasuredAtDateMismatchError'
  }
}

export class InvalidBodyCompositionDeviceError extends BodyCompositionDomainError {
  constructor(device: string) {
    super(
      'body_composition/invalid_device',
      'device must contain 1 to 100 characters',
      {
        device,
      },
    )
    this.name = 'InvalidBodyCompositionDeviceError'
  }
}

export class BodyCompositionNoValuesError extends BodyCompositionDomainError {
  constructor() {
    super(
      'body_composition/no_values',
      'at least one body composition value is required',
    )
    this.name = 'BodyCompositionNoValuesError'
  }
}

export class InvalidBodyCompositionValueError extends BodyCompositionDomainError {
  constructor(field: string, value: number) {
    super(
      'body_composition/invalid_value',
      `${field} is outside its supported range or has more than 2 decimal places: ${String(value)}`,
      { field, value },
    )
    this.name = 'InvalidBodyCompositionValueError'
  }
}

export class DuplicateBodyCompositionError extends BodyCompositionDomainError {
  constructor(cause?: unknown) {
    super(
      'body_composition/duplicate',
      'body composition conflicts with another measurement',
      {},
      cause,
    )
    this.name = 'DuplicateBodyCompositionError'
  }
}

export class BodyCompositionNotFoundError extends BodyCompositionDomainError {
  constructor(id: string) {
    super('body_composition/not_found', `body composition not found: ${id}`, {
      id,
    })
    this.name = 'BodyCompositionNotFoundError'
  }
}

export class BodyCompositionPersistenceError extends BodyCompositionDomainError {
  constructor(message: string, cause?: unknown) {
    super('body_composition/persistence_failed', message, {}, cause)
    this.name = 'BodyCompositionPersistenceError'
  }
}
