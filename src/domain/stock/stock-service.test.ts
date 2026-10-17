import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { StockDomainError } from '#domain/stock/errors'
import { createStockService } from '#domain/stock/stock-service'
import type {
  CountStockInput,
  ReceiveDeliveryInput,
  RegisterDeliveryInput,
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
  registerDelivery: (input: RegisterDeliveryInput) =>
    okAsync({
      id: 'dly_test',
      sourceRef: input.sourceRef ?? null,
      status: input.status,
      expectedDate: input.expectedDate,
      receivedDate: null,
      changeDeadline: input.changeDeadline ?? null,
      items: [],
    }),
  receiveDelivery: (input: ReceiveDeliveryInput) =>
    okAsync({
      id: input.deliveryId,
      sourceRef: null,
      status: 'received',
      expectedDate: '2026-10-01',
      receivedDate: input.receivedDate,
      changeDeadline: null,
      items: [],
    }),
  getStockStatus: () => okAsync({ stockItems: [], plannedDeliveries: [] }),
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

const invalidDeliveryInputs: ReadonlyArray<{
  readonly name: string
  readonly input: RegisterDeliveryInput
  readonly message: string
}> = [
  {
    name: 'blank source reference',
    input: {
      sourceRef: '  ',
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_sample', quantity: 1 }],
    },
    message: 'source_ref must not be empty',
  },
  {
    name: 'invalid expected date',
    input: {
      status: 'planned',
      expectedDate: '2026-02-30',
      items: [{ foodMasterId: 'fm_sample', quantity: 1 }],
    },
    message: 'expected_date must be YYYY-MM-DD',
  },
  {
    name: 'empty planned delivery',
    input: {
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [],
    },
    message: 'planned deliveries must include at least one item',
  },
  {
    name: 'duplicate delivery food',
    input: {
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [
        { foodMasterId: 'fm_sample', quantity: 1 },
        { foodMasterId: 'fm_sample', quantity: 2 },
      ],
    },
    message: 'items must not contain duplicate food_master_id values',
  },
  {
    name: 'nonpositive planned quantity',
    input: {
      status: 'planned',
      expectedDate: '2026-10-20',
      items: [{ foodMasterId: 'fm_sample', quantity: 0 }],
    },
    message: 'quantity must be greater than 0',
  },
]

it.each(invalidDeliveryInputs)('rejects $name', async ({ input, message }) => {
  const result = await stockService.registerDelivery(input)

  expect(result._unsafeUnwrapErr()).toEqual(
    new StockDomainError('invalid_input', message),
  )
})

const invalidReceiveInputs: ReadonlyArray<{
  readonly name: string
  readonly input: ReceiveDeliveryInput
  readonly message: string
}> = [
  {
    name: 'blank delivery ID',
    input: { deliveryId: ' ', receivedDate: '2026-10-21' },
    message: 'delivery_id must not be empty',
  },
  {
    name: 'invalid received date',
    input: { deliveryId: 'dly_sample', receivedDate: '2026-02-30' },
    message: 'received_date must be YYYY-MM-DD',
  },
  {
    name: 'negative actual quantity',
    input: {
      deliveryId: 'dly_sample',
      receivedDate: '2026-10-21',
      items: [{ foodMasterId: 'fm_sample', quantity: -1 }],
    },
    message: 'quantity must be greater than or equal to 0',
  },
  {
    name: 'duplicate actual food',
    input: {
      deliveryId: 'dly_sample',
      receivedDate: '2026-10-21',
      items: [
        { foodMasterId: 'fm_sample', quantity: 1 },
        { foodMasterId: 'fm_sample', quantity: 2 },
      ],
    },
    message: 'items must not contain duplicate food_master_id values',
  },
]

it.each(invalidReceiveInputs)('rejects $name', async ({ input, message }) => {
  const result = await stockService.receiveDelivery(input)

  expect(result._unsafeUnwrapErr()).toEqual(
    new StockDomainError('invalid_input', message),
  )
})
