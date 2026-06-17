export type FoodMasterErrorCode =
  | 'empty_name'
  | 'empty_alias'
  | 'duplicate_alias_in_input'
  | 'invalid_source_combination'
  | 'unknown_nutrient_code'
  | 'negative_nutrient_value'
  | 'duplicate_name'
  | 'duplicate_alias'

export class FoodMasterDomainError extends Error {
  readonly code: FoodMasterErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: FoodMasterErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message)
    this.name = 'FoodMasterDomainError'
    this.code = code
    this.details = details
  }
}
