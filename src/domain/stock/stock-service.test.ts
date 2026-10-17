import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { StockDomainError } from '#domain/stock/errors'
import { createStockService } from '#domain/stock/stock-service'
import type {
  CountStockInput,
  SetStockItemInput,
  StockRepository,
} from '#domain/stock/types'

const repository: StockRepository = {
  setStockItem: (input) =>
    okAsync({
      foodMasterId: input.foodMasterId,
      foodName: 'Sample food',
      storageLocation: null,
      eatWithinDays: null,
    }),
  countStock: (input) =>
    okAsync({
      foodMasterId: input.foodMasterId,
      previousQuantity: 0,
      countedQuantity: input.quantity,
      difference: input.quantity,
    }),
  getStockStatus: () => okAsync([]),
}

const stockService = createStockService(repository)

const invalidSetInputs: ReadonlyArray<{
  readonly name: string
  readonly input: SetStockItemInput
  readonly message: string
}> = [
  {
    name: 'blank storage location name',
    input: { foodMasterId: 'fm_sample', storageLocationName: '  ' },
    message: 'storage_location_name must not be empty',
  },
  {
    name: 'nonpositive storage location capacity',
    input: { foodMasterId: 'fm_sample', storageLocationCapacity: 0 },
    message: 'storage_location_capacity must be greater than 0',
  },
  {
    name: 'nonpositive eat-within days',
    input: { foodMasterId: 'fm_sample', eatWithinDays: 0 },
    message: 'eat_within_days must be a positive integer',
  },
  {
    name: 'capacity without a storage location',
    input: {
      foodMasterId: 'fm_sample',
      storageLocationName: null,
      storageLocationCapacity: 4,
    },
    message: 'storage_location_capacity requires a storage location',
  },
]

it.each(invalidSetInputs)('rejects $name', async ({ input, message }) => {
  const result = await stockService.setStockItem(input)

  expect(result._unsafeUnwrapErr()).toEqual(
    new StockDomainError('invalid_input', message),
  )
})

const invalidCountInputs: ReadonlyArray<{
  readonly name: string
  readonly input: CountStockInput
  readonly message: string
}> = [
  {
    name: 'negative quantity',
    input: { foodMasterId: 'fm_sample', quantity: -0.5 },
    message: 'quantity must be greater than or equal to 0',
  },
  {
    name: 'invalid received date',
    input: {
      foodMasterId: 'fm_sample',
      quantity: 1,
      receivedDate: '2026-13-01',
    },
    message: 'received_date must be YYYY-MM-DD',
  },
  {
    name: 'invalid best-before date',
    input: {
      foodMasterId: 'fm_sample',
      quantity: 1,
      bestBefore: '2026-02-30',
    },
    message: 'best_before must be YYYY-MM-DD',
  },
]

it.each(invalidCountInputs)('rejects $name', async ({ input, message }) => {
  const result = await stockService.countStock(input)

  expect(result._unsafeUnwrapErr()).toEqual(
    new StockDomainError('invalid_input', message),
  )
})
