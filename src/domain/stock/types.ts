import type { ResultAsync } from 'neverthrow'

import type { StockDomainError } from '#domain/stock/errors'
import type { JstDate } from '#lib/jst-date'

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

interface StockItemStatusSnapshot extends StockItemStatus {
  readonly storageLocationId: string | null
}

interface PlannedDelivery {
  readonly id: string
  readonly sourceRef: string | null
  readonly expectedDate: string
  readonly changeDeadline: string | null
  readonly items: ReadonlyArray<DeliveryItem>
}

export interface StockStatus {
  readonly stockItems: ReadonlyArray<StockItemStatusSnapshot>
  readonly plannedDeliveries: ReadonlyArray<PlannedDelivery>
  readonly capacityWarnings: ReadonlyArray<CapacityWarning>
  readonly eatByWarnings: ReadonlyArray<EatByWarning>
  readonly priorityLots: ReadonlyArray<PriorityLot>
}

export interface StockStatusSnapshot {
  readonly stockItems: ReadonlyArray<StockItemStatusSnapshot>
  readonly plannedDeliveries: ReadonlyArray<PlannedDelivery>
  readonly recentConsumption: ReadonlyArray<{
    readonly foodMasterId: string
    readonly quantity: number
  }>
}

export interface CapacityWarning {
  readonly id: string
  readonly storageLocationId: string
  readonly storageLocationName: string
  readonly deliveryId: string
  readonly sourceRef: string | null
  readonly expectedDate: string
  readonly changeDeadline: string | null
  readonly projectedQuantity: number
  readonly capacity: number
  readonly excessQuantity: number
}

export interface EatByWarning {
  readonly id: string
  readonly stockLotId: string
  readonly foodMasterId: string
  readonly foodName: string
  readonly targetDate: string
  readonly targetDateType: 'best_before' | 'eat_by'
  readonly remainingQuantity: number
  readonly requiredDailyConsumption: number
  readonly actualDailyConsumption: number
}

export type PriorityLotReason =
  | 'best_before'
  | 'eat_by'
  | 'oldest_received'
  | 'deadline_passed'
  | 'consumption_rate_below_required'

export interface PriorityLot {
  readonly foodMasterId: string
  readonly foodName: string
  readonly stockLotId: string
  readonly remainingQuantity: number
  readonly targetDate: string
  readonly reasons: ReadonlyArray<PriorityLotReason>
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
  getStockStatus(
    today: JstDate,
  ): ResultAsync<StockStatusSnapshot, StockDomainError>
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
