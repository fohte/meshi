import { CodedDomainError } from '#domain/errors'

export type FoodMasterErrorCode =
  | 'empty_name'
  | 'empty_alias'
  | 'duplicate_alias_in_input'
  | 'invalid_source_combination'
  | 'empty_nutrition'
  | 'missing_source_url'
  | 'unexpected_source_url'
  | 'missing_composition_code'
  | 'unexpected_composition_code'
  | 'unknown_nutrient_code'
  | 'negative_nutrient_value'
  | 'duplicate_name'
  | 'duplicate_alias'
  | 'composition_not_found'
  | 'food_master_not_found'
  | 'same_food_master'
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
