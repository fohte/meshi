import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import type {
  CountStockInput,
  StockItem,
  StockItemStatus,
  StockService,
} from '#domain/stock/types'
import { createMcpServer } from '#mcp'
import { createStubMcpDeps } from '#test/mcp-stubs'

const createStockServiceStub = (
  overrides: {
    readonly stockItem?: StockItem
    readonly status?: ReadonlyArray<StockItemStatus>
  } = {},
  onCount?: (input: CountStockInput) => void,
): StockService => ({
  setStockItem(input) {
    return okAsync(
      overrides.stockItem ?? {
        foodMasterId: input.foodMasterId,
        foodName: 'Sample stock food',
        storageLocation:
          input.storageLocationName == null
            ? null
            : {
                name: input.storageLocationName,
                capacity: input.storageLocationCapacity ?? null,
              },
        eatWithinDays: input.eatWithinDays ?? null,
      },
    )
  },
  countStock(input) {
    onCount?.(input)
    return okAsync({
      foodMasterId: input.foodMasterId,
      previousQuantity: 0,
      countedQuantity: input.quantity,
      difference: input.quantity,
      remainingQuantity: input.quantity,
    })
  },
  getStockStatus() {
    return okAsync(overrides.status ?? [])
  },
})

const connect = async (
  stockService: StockService,
): Promise<{ client: Client; close: () => Promise<void> }> => {
  const server = createMcpServer({
    ...createStubMcpDeps(),
    stockService,
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'stock-tools-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

it('routes set_stock_item arguments and returns the saved settings', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'set_stock_item',
      arguments: {
        food_master_id: 'fm_sample_stock',
        storage_location_name: 'Sample freezer',
        storage_location_capacity: 8,
        eat_within_days: 20,
      },
    })

    expect(result.structuredContent).toEqual({
      food_master_id: 'fm_sample_stock',
      food_name: 'Sample stock food',
      storage_location: { name: 'Sample freezer', capacity: 8 },
      eat_within_days: 20,
    })
  } finally {
    await h.close()
  }
})

it('routes count_stock quantities and lot dates', async () => {
  const countInputs: CountStockInput[] = []
  const h = await connect(
    createStockServiceStub({}, (input) => countInputs.push(input)),
  )
  try {
    await h.client.callTool({
      name: 'count_stock',
      arguments: {
        food_master_id: 'fm_counted',
        quantity: 1.5,
        received_date: '2026-10-01',
        best_before: '2026-11-01',
      },
    })

    expect(countInputs).toEqual([
      {
        foodMasterId: 'fm_counted',
        quantity: 1.5,
        receivedDate: '2026-10-01',
        bestBefore: '2026-11-01',
      },
    ])
  } finally {
    await h.close()
  }
})

it('returns the count_stock result', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'count_stock',
      arguments: { food_master_id: 'fm_counted', quantity: 1.5 },
    })

    expect(result.structuredContent).toEqual({
      food_master_id: 'fm_counted',
      previous_quantity: 0,
      counted_quantity: 1.5,
      difference: 1.5,
      remaining_quantity: 1.5,
    })
  } finally {
    await h.close()
  }
})

it('rejects negative count quantities before calling the service', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'count_stock',
      arguments: { food_master_id: 'fm_sample_stock', quantity: -0.5 },
    })

    expect(result.isError).toEqual(true)
  } finally {
    await h.close()
  }
})

it('returns lot level stock status', async () => {
  const h = await connect(
    createStockServiceStub({
      status: [
        {
          foodMasterId: 'fm_status',
          foodName: 'Sample food status',
          storageLocation: { name: 'Sample shelf', capacity: 6 },
          eatWithinDays: 14,
          totalQuantity: 1.5,
          lots: [
            {
              id: 'stl_status',
              quantity: 2,
              remainingQuantity: 1.5,
              receivedDate: '2026-10-01',
              bestBefore: '2026-11-01',
              eatBy: '2026-10-15',
            },
          ],
        },
      ],
    }),
  )
  try {
    const result = await h.client.callTool({
      name: 'get_stock_status',
      arguments: {},
    })

    expect(result.structuredContent).toEqual({
      stock_items: [
        {
          food_master_id: 'fm_status',
          food_name: 'Sample food status',
          total_quantity: 1.5,
          storage_location: { name: 'Sample shelf', capacity: 6 },
          eat_within_days: 14,
          lots: [
            {
              stock_lot_id: 'stl_status',
              quantity: 2,
              remaining_quantity: 1.5,
              received_date: '2026-10-01',
              best_before: '2026-11-01',
              eat_by: '2026-10-15',
            },
          ],
        },
      ],
    })
  } finally {
    await h.close()
  }
})
