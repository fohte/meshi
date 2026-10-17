import type { ResultAsync } from 'neverthrow'

import type { StockDomainError } from '#domain/stock/errors'

export interface SetStockItemInput {
  readonly foodMasterId: string
  readonly storageLocationName?: string | null
  readonly storageLocationCapacity?: number | null
  readonly eatWithinDays?: number | null
}

export interface CountStockInput {
  readonly foodMasterId: string
  readonly quantity: number
  readonly receivedDate?: string | null
  readonly bestBefore?: string | null
}

interface StockStorageLocation {
  readonly name: string
  readonly capacity: number | null
}

export interface StockItem {
  readonly foodMasterId: string
  readonly foodName: string
  readonly storageLocation: StockStorageLocation | null
  readonly eatWithinDays: number | null
}

export interface StockCountResult {
  readonly foodMasterId: string
  readonly previousQuantity: number
  readonly countedQuantity: number
  readonly difference: number
}

interface StockLotStatus {
  readonly id: string
  readonly quantity: number
  readonly remainingQuantity: number
  readonly receivedDate: string | null
  readonly bestBefore: string | null
  readonly eatBy: string | null
}

export interface StockItemStatus extends StockItem {
  readonly totalQuantity: number
  readonly lots: ReadonlyArray<StockLotStatus>
}

export interface StockRepository {
  setStockItem(
    input: SetStockItemInput,
  ): ResultAsync<StockItem, StockDomainError>
  countStock(
    input: CountStockInput,
  ): ResultAsync<StockCountResult, StockDomainError>
  getStockStatus(): ResultAsync<
    ReadonlyArray<StockItemStatus>,
    StockDomainError
  >
}

export interface StockService {
  setStockItem(
    input: SetStockItemInput,
  ): ResultAsync<StockItem, StockDomainError>
  countStock(
    input: CountStockInput,
  ): ResultAsync<StockCountResult, StockDomainError>
  getStockStatus(): ResultAsync<
    ReadonlyArray<StockItemStatus>,
    StockDomainError
  >
}
