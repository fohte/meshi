import { CodedDomainError } from '#domain/errors'

export type StockDomainErrorCode =
  | 'food_master_not_found'
  | 'stock_item_not_found'
  | 'invalid_input'
  | 'persistence_failed'

export class StockDomainError extends CodedDomainError<StockDomainErrorCode> {
  constructor(
    code: StockDomainErrorCode,
    message: string,
    details: Readonly<Record<string, unknown>> = {},
    cause?: unknown,
  ) {
    super(code, message, details, cause)
    this.name = 'StockDomainError'
  }
}
