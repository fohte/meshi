export type FoodMasterUnitErrorCode =
  | 'empty_unit'
  | 'implausible_grams_per_unit'
  | 'duplicate_unit'
  | 'food_master_not_found'
  | 'persistence_failed'

export class FoodMasterUnitDomainError extends Error {
  readonly code: FoodMasterUnitErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: FoodMasterUnitErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodMasterUnitDomainError'
    this.code = code
    this.details = details
  }
}
