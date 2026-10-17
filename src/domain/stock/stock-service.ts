import { errAsync } from 'neverthrow'
import { z } from 'zod'

import { StockDomainError } from '#domain/stock/errors'
import type {
  CountStockInput,
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

  getStockStatus: () => repository.getStockStatus(),
})
