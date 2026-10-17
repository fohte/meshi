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

interface DeliveryItemInput {
  readonly foodMasterId: string
  readonly quantity: number
}

type RegisterableDeliveryStatus = 'planned' | 'cancelled'

export interface RegisterDeliveryInput {
  readonly sourceRef?: string | null
  readonly status: RegisterableDeliveryStatus
  readonly expectedDate: string
  readonly changeDeadline?: string | null
  readonly items: ReadonlyArray<DeliveryItemInput>
}

export interface ReceiveDeliveryInput {
  readonly deliveryId: string
  readonly receivedDate: string
  readonly items?: ReadonlyArray<DeliveryItemInput>
}

export interface DeliveryItem {
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: number
}

export interface Delivery {
  readonly id: string
  readonly sourceRef: string | null
  readonly status: 'planned' | 'received' | 'cancelled'
  readonly expectedDate: string
  readonly receivedDate: string | null
  readonly changeDeadline: string | null
  readonly items: ReadonlyArray<DeliveryItem>
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

interface StockItemStatus extends StockItem {
  readonly totalQuantity: number
  readonly lots: ReadonlyArray<StockLotStatus>
}

interface PlannedDelivery {
  readonly id: string
  readonly sourceRef: string | null
  readonly expectedDate: string
  readonly changeDeadline: string | null
  readonly items: ReadonlyArray<DeliveryItem>
}

export interface StockStatus {
  readonly stockItems: ReadonlyArray<StockItemStatus>
  readonly plannedDeliveries: ReadonlyArray<PlannedDelivery>
}

export interface StockRepository {
  setStockItem(
    input: SetStockItemInput,
  ): ResultAsync<StockItem, StockDomainError>
  countStock(
    input: CountStockInput,
  ): ResultAsync<StockCountResult, StockDomainError>
  registerDelivery(
    input: RegisterDeliveryInput,
  ): ResultAsync<Delivery, StockDomainError>
  receiveDelivery(
    input: ReceiveDeliveryInput,
  ): ResultAsync<Delivery, StockDomainError>
  getStockStatus(): ResultAsync<StockStatus, StockDomainError>
}

export interface StockService {
  setStockItem(
    input: SetStockItemInput,
  ): ResultAsync<StockItem, StockDomainError>
  countStock(
    input: CountStockInput,
  ): ResultAsync<StockCountResult, StockDomainError>
  registerDelivery(
    input: RegisterDeliveryInput,
  ): ResultAsync<Delivery, StockDomainError>
  receiveDelivery(
    input: ReceiveDeliveryInput,
  ): ResultAsync<Delivery, StockDomainError>
  getStockStatus(): ResultAsync<StockStatus, StockDomainError>
}
