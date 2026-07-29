import { CodedDomainError } from '#domain/errors'

export type FoodMasterErrorCode =
  | 'empty_name'
  | 'empty_alias'
  | 'duplicate_alias_in_input'
  | 'invalid_source_combination'
  | 'unknown_nutrient_code'
  | 'negative_nutrient_value'
  | 'empty_unit'
  | 'reserved_unit'
  | 'duplicate_unit_in_input'
  | 'implausible_grams_per_unit'
  | 'duplicate_name'
  | 'duplicate_alias'
  | 'persistence_failed'

export class FoodMasterDomainError extends CodedDomainError<FoodMasterErrorCode> {
  constructor(
    code: FoodMasterErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'FoodMasterDomainError'
  }
}
