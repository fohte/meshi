import { errAsync } from 'neverthrow'
import { z } from 'zod'

import { StockDomainError } from '#domain/stock/errors'
import type {
  CountStockInput,
  ReceiveDeliveryInput,
  RegisterDeliveryInput,
  SetStockItemInput,
  StockRepository,
  StockService,
} from '#domain/stock/types'

const validDate = z.iso.date()

export const createStockService = (
  repository: StockRepository,
): StockService => ({
  setStockItem(input: SetStockItemInput) {
    const locationName = input.storageLocationName
    if (typeof locationName === 'string' && locationName.trim() === '') {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'storage_location_name must not be empty',
        ),
      )
    }
    if (
      input.storageLocationCapacity !== undefined &&
      input.storageLocationName === null
    ) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'storage_location_capacity requires a storage location',
        ),
      )
    }
    if (
      input.storageLocationCapacity !== undefined &&
      input.storageLocationCapacity !== null &&
      (!Number.isFinite(input.storageLocationCapacity) ||
        input.storageLocationCapacity <= 0)
    ) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'storage_location_capacity must be greater than 0',
        ),
      )
    }
    if (
      input.eatWithinDays !== undefined &&
      input.eatWithinDays !== null &&
      (!Number.isInteger(input.eatWithinDays) || input.eatWithinDays <= 0)
    ) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'eat_within_days must be a positive integer',
        ),
      )
    }

    return repository.setStockItem({
      ...input,
      ...(typeof locationName === 'string'
        ? { storageLocationName: locationName.trim() }
        : {}),
    })
  },

  countStock(input: CountStockInput) {
    if (!Number.isFinite(input.quantity) || input.quantity < 0) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'quantity must be greater than or equal to 0',
        ),
      )
    }
    for (const [field, value] of [
      ['received_date', input.receivedDate],
      ['best_before', input.bestBefore],
    ] as const) {
      if (
        value !== undefined &&
        value !== null &&
        !validDate.safeParse(value).success
      ) {
        return errAsync(
          new StockDomainError('invalid_input', `${field} must be YYYY-MM-DD`),
        )
      }
    }
    return repository.countStock(input)
  },

  registerDelivery(input: RegisterDeliveryInput) {
    const sourceRef = input.sourceRef?.trim()
    if (sourceRef === '') {
      return errAsync(
        new StockDomainError('invalid_input', 'source_ref must not be empty'),
      )
    }
    if (!validDate.safeParse(input.expectedDate).success) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'expected_date must be YYYY-MM-DD',
        ),
      )
    }
    if (
      input.changeDeadline != null &&
      !validDate.safeParse(input.changeDeadline).success
    ) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'change_deadline must be YYYY-MM-DD',
        ),
      )
    }
    if (input.status === 'planned' && input.items.length === 0) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'planned deliveries must include at least one item',
        ),
      )
    }
    const items = input.items.map((item) => ({
      ...item,
      foodMasterId: item.foodMasterId.trim(),
    }))
    const itemError = validateDeliveryItems(items, false)
    if (itemError !== undefined) {
      return errAsync(new StockDomainError('invalid_input', itemError))
    }
    return repository.registerDelivery({
      ...input,
      ...(sourceRef === undefined ? {} : { sourceRef }),
      items,
    })
  },

  receiveDelivery(input: ReceiveDeliveryInput) {
    const deliveryId = input.deliveryId.trim()
    if (deliveryId === '') {
      return errAsync(
        new StockDomainError('invalid_input', 'delivery_id must not be empty'),
      )
    }
    if (!validDate.safeParse(input.receivedDate).success) {
      return errAsync(
        new StockDomainError(
          'invalid_input',
          'received_date must be YYYY-MM-DD',
        ),
      )
    }
    const items = input.items?.map((item) => ({
      ...item,
      foodMasterId: item.foodMasterId.trim(),
    }))
    const itemError = validateDeliveryItems(items ?? [], true)
    if (itemError !== undefined) {
      return errAsync(new StockDomainError('invalid_input', itemError))
    }
    return repository.receiveDelivery({
      ...input,
      deliveryId,
      ...(items === undefined ? {} : { items }),
    })
  },

  getStockStatus: () => repository.getStockStatus(),
})

const validateDeliveryItems = (
  items: ReadonlyArray<{
    readonly foodMasterId: string
    readonly quantity: number
  }>,
  allowZeroQuantity: boolean,
): string | undefined => {
  const seenFoodMasterIds = new Set<string>()
  for (const item of items) {
    const foodMasterId = item.foodMasterId.trim()
    if (foodMasterId === '') {
      return 'food_master_id must not be empty'
    }
    if (seenFoodMasterIds.has(foodMasterId)) {
      return 'items must not contain duplicate food_master_id values'
    }
    seenFoodMasterIds.add(foodMasterId)
    if (
      !Number.isFinite(item.quantity) ||
      (allowZeroQuantity ? item.quantity < 0 : item.quantity <= 0)
    ) {
      return allowZeroQuantity
        ? 'quantity must be greater than or equal to 0'
        : 'quantity must be greater than 0'
    }
  }
  return undefined
}
