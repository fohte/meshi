import { CodedDomainError } from '#domain/errors'

export type FoodMasterUnitErrorCode =
  | 'empty_unit'
  | 'reserved_unit'
  | 'implausible_grams_per_unit'
  | 'duplicate_unit'
  | 'food_master_not_found'
  | 'persistence_failed'

export class FoodMasterUnitDomainError extends CodedDomainError<FoodMasterUnitErrorCode> {
  constructor(
    code: FoodMasterUnitErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'FoodMasterUnitDomainError'
  }
}
