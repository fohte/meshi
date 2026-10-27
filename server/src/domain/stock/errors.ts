import { CodedDomainError } from '#domain/errors'

export type StockDomainErrorCode =
  | 'food_master_not_found'
  | 'stock_item_not_found'
  | 'stock_lot_not_found'
  | 'delivery_not_found'
  | 'delivery_not_planned'
  | 'delivery_source_ref_conflict'
  | 'delivery_item_not_found'
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
