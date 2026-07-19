export type FoodMasterErrorCode =
  | 'empty_name'
  | 'empty_alias'
  | 'duplicate_alias_in_input'
  | 'invalid_source_combination'
  | 'unknown_nutrient_code'
  | 'negative_nutrient_value'
  | 'duplicate_name'
  | 'duplicate_alias'
  | 'persistence_failed'

export class FoodMasterDomainError extends Error {
  readonly code: FoodMasterErrorCode
  readonly details: Readonly<Record<string, unknown>>

  constructor(
    code: FoodMasterErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'FoodMasterDomainError'
    this.code = code
    this.details = details
  }
}
