import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { StockDomainError } from '#domain/stock/errors'
import type {
  CountStockInput,
  Delivery,
  ListDeliveriesInput,
  ListedDelivery,
  ReceiveDeliveryInput,
  RegisterDeliveryInput,
  StockItem,
  StockService,
  StockStatus,
  UpdatedStockLot,
  UpdateStockLotInput,
} from '#domain/stock/types'
import { createMcpServer } from '#mcp'
import { createStubMcpDeps } from '#test/mcp-stubs'

const VALIDATION_ERROR_TEXT = '<schema validation error>'

const normalizeValidationError = <
  T extends { content?: { type: string }[]; [key: string]: unknown },
>(
  result: T,
): T => {
  if (!result.content) return result
  return {
    ...result,
    content: result.content.map((content) =>
      content.type === 'text'
        ? { ...content, text: VALIDATION_ERROR_TEXT }
        : content,
    ),
  }
}

const createStockServiceStub = (
  overrides: {
    readonly stockItem?: StockItem
    readonly status?: StockStatus
    readonly delivery?: Delivery
    readonly listedDeliveries?: ReadonlyArray<ListedDelivery>
    readonly listDeliveriesError?: StockDomainError
  } = {},
  onCount?: (input: CountStockInput) => void,
  onRegister?: (input: RegisterDeliveryInput) => void,
  onReceive?: (input: ReceiveDeliveryInput) => void,
  onUpdateStockLot?: (input: UpdateStockLotInput) => void,
  onListDeliveries?: (input: ListDeliveriesInput) => void,
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
    })
  },
  updateStockLot(input) {
    onUpdateStockLot?.(input)
    const lot: UpdatedStockLot = {
      id: input.stockLotId,
      bestBefore: input.bestBefore ?? null,
      eatBy: input.eatBy ?? null,
    }
    return okAsync(lot)
  },
  registerDelivery(input) {
    onRegister?.(input)
    return okAsync(
      overrides.delivery ?? {
        id: 'dly_sample',
        sourceRef: input.sourceRef ?? null,
        status: input.status,
        expectedDate: input.expectedDate,
        receivedDate: null,
        changeDeadline: input.changeDeadline ?? null,
        items: input.items.map((item) => ({
          foodMasterId: item.foodMasterId,
          foodName: 'Sample stock food',
          quantity: item.quantity,
        })),
      },
    )
  },
  receiveDelivery(input) {
    onReceive?.(input)
    return okAsync(
      overrides.delivery ?? {
        id: input.deliveryId,
        sourceRef: 'source-sample',
        status: 'received',
        expectedDate: '2026-10-01',
        receivedDate: input.receivedDate,
        changeDeadline: null,
        items: (input.items ?? []).map((item) => ({
          foodMasterId: item.foodMasterId,
          foodName: 'Sample stock food',
          quantity: item.quantity,
        })),
      },
    )
  },
  getStockStatus() {
    return okAsync(
      overrides.status ?? {
        stockItems: [],
        plannedDeliveries: [],
        capacityWarnings: [],
        eatByWarnings: [],
        priorityLots: [],
      },
    )
  },
  listDeliveries(input) {
    onListDeliveries?.(input)
    if (overrides.listDeliveriesError !== undefined) {
      return errAsync(overrides.listDeliveriesError)
    }
    return okAsync(overrides.listedDeliveries ?? [])
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

const listedDeliveryFixture: ListedDelivery = {
  id: 'dly_received_sample',
  sourceRef: 'ref_order_sample',
  status: 'received',
  expectedDate: '2031-05-01',
  receivedDate: '2031-05-02',
  changeDeadline: '2031-04-28',
  items: [
    {
      foodMasterId: 'fm_sample_grain',
      foodName: 'Sample grain packet',
      stockLotId: 'stl_consumed_sample',
      quantity: 2,
      remainingQuantity: 0,
    },
  ],
}

it('routes list_deliveries filters and defaults limit to twenty', async () => {
  const inputs: ListDeliveriesInput[] = []
  const h = await connect(
    createStockServiceStub(
      { listedDeliveries: [listedDeliveryFixture] },
      undefined,
      undefined,
      undefined,
      undefined,
      (input) => inputs.push(input),
    ),
  )
  try {
    await h.client.callTool({
      name: 'list_deliveries',
      arguments: {
        delivery_id: ' dly_received_sample ',
        source_ref: ' ref_order_sample ',
        status: 'received',
      },
    })
    expect(inputs).toEqual([
      {
        deliveryId: 'dly_received_sample',
        sourceRef: 'ref_order_sample',
        status: 'received',
        limit: 20,
      },
    ])
  } finally {
    await h.close()
  }
})

it('returns lot balances from list_deliveries', async () => {
  const h = await connect(
    createStockServiceStub({ listedDeliveries: [listedDeliveryFixture] }),
  )
  try {
    const result = await h.client.callTool({
      name: 'list_deliveries',
      arguments: {},
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: '1 件の配送を取得しました。' }],
      structuredContent: {
        deliveries: [
          {
            delivery_id: 'dly_received_sample',
            source_ref: 'ref_order_sample',
            status: 'received',
            expected_date: '2031-05-01',
            received_date: '2031-05-02',
            change_deadline: '2031-04-28',
            items: [
              {
                food_master_id: 'fm_sample_grain',
                food_name: 'Sample grain packet',
                stock_lot_id: 'stl_consumed_sample',
                quantity: 2,
                remaining_quantity: 0,
              },
            ],
          },
        ],
      },
    })
  } finally {
    await h.close()
  }
})

it('returns a tool error when list_deliveries fails', async () => {
  const h = await connect(
    createStockServiceStub({
      listDeliveriesError: new StockDomainError(
        'persistence_failed',
        'delivery lookup failed',
      ),
    }),
  )
  try {
    const result = await h.client.callTool({
      name: 'list_deliveries',
      arguments: {},
    })

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'delivery lookup failed' }],
    })
  } finally {
    await h.close()
  }
})

it('marks list_deliveries as read-only', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const listedTool = (await h.client.listTools()).tools.find(
      (tool) => tool.name === 'list_deliveries',
    )

    expect(listedTool?.annotations).toEqual({ readOnlyHint: true })
  } finally {
    await h.close()
  }
})

it('rejects list_deliveries limits above fifty', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'list_deliveries',
      arguments: { limit: 51 },
    })

    expect(normalizeValidationError(result)).toEqual({
      content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
      isError: true,
    })
  } finally {
    await h.close()
  }
})

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

    expect(result).toEqual({
      content: [{ type: 'text', text: '在庫管理の設定を保存しました。' }],
      structuredContent: {
        food_master_id: 'fm_sample_stock',
        food_name: 'Sample stock food',
        storage_location: { name: 'Sample freezer', capacity: 8 },
        eat_within_days: 20,
      },
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

    expect(result).toEqual({
      content: [{ type: 'text', text: '棚卸し結果を保存しました。' }],
      structuredContent: {
        food_master_id: 'fm_counted',
        previous_quantity: 0,
        counted_quantity: 1.5,
        difference: 1.5,
      },
    })
  } finally {
    await h.close()
  }
})

it('routes update_stock_lot arguments without turning omitted dates into null', async () => {
  const updateInputs: UpdateStockLotInput[] = []
  const h = await connect(
    createStockServiceStub({}, undefined, undefined, undefined, (input) =>
      updateInputs.push(input),
    ),
  )
  try {
    await h.client.callTool({
      name: 'update_stock_lot',
      arguments: {
        stock_lot_id: 'stl_editable',
        best_before: null,
      },
    })

    expect(updateInputs).toEqual([
      {
        stockLotId: 'stl_editable',
        bestBefore: null,
      },
    ])
  } finally {
    await h.close()
  }
})

it('returns the updated update_stock_lot dates', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'update_stock_lot',
      arguments: {
        stock_lot_id: 'stl_editable',
        best_before: '2031-05-10',
        eat_by: '2031-05-12',
      },
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: '入荷分の日付を更新しました。' }],
      structuredContent: {
        stock_lot_id: 'stl_editable',
        best_before: '2031-05-10',
        eat_by: '2031-05-12',
      },
    })
  } finally {
    await h.close()
  }
})

it('returns a tool error when update_stock_lot cannot find the lot', async () => {
  const h = await connect({
    ...createStockServiceStub(),
    updateStockLot: () =>
      errAsync(
        new StockDomainError(
          'stock_lot_not_found',
          'stock_lot not found: stl_unknown',
          { stockLotId: 'stl_unknown' },
        ),
      ),
  })
  try {
    const result = await h.client.callTool({
      name: 'update_stock_lot',
      arguments: {
        stock_lot_id: 'stl_unknown',
        eat_by: '2031-05-12',
      },
    })

    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: 'stock_lot not found: stl_unknown' }],
    })
  } finally {
    await h.close()
  }
})

it('requires at least one date for update_stock_lot', async () => {
  const h = await connect(createStockServiceStub())
  try {
    const result = await h.client.callTool({
      name: 'update_stock_lot',
      arguments: { stock_lot_id: 'stl_editable' },
    })

    expect(normalizeValidationError(result)).toEqual({
      content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
      isError: true,
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

    expect(normalizeValidationError(result)).toEqual({
      content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
      isError: true,
    })
  } finally {
    await h.close()
  }
})

it('routes register_delivery arguments', async () => {
  const registerInputs: RegisterDeliveryInput[] = []
  const h = await connect(
    createStockServiceStub({}, undefined, (input) =>
      registerInputs.push(input),
    ),
  )
  try {
    await h.client.callTool({
      name: 'register_delivery',
      arguments: {
        source_ref: 'sample-order',
        status: 'planned',
        expected_date: '2026-10-20',
        change_deadline: '2026-10-18',
        items: [{ food_master_id: 'fm_sample_stock', quantity: 3 }],
      },
    })

    expect(registerInputs).toEqual([
      {
        sourceRef: 'sample-order',
        status: 'planned',
        expectedDate: '2026-10-20',
        changeDeadline: '2026-10-18',
        items: [{ foodMasterId: 'fm_sample_stock', quantity: 3 }],
      },
    ])
  } finally {
    await h.close()
  }
})

it('returns the saved register_delivery payload', async () => {
  const delivery: Delivery = {
    id: 'dly_sample',
    sourceRef: 'sample-order',
    status: 'planned',
    expectedDate: '2026-10-20',
    receivedDate: null,
    changeDeadline: '2026-10-18',
    items: [
      {
        foodMasterId: 'fm_sample_stock',
        foodName: 'Sample stock food',
        quantity: 3,
      },
    ],
  }
  const h = await connect(createStockServiceStub({ delivery }))
  try {
    const result = await h.client.callTool({
      name: 'register_delivery',
      arguments: {
        source_ref: 'sample-order',
        status: 'planned',
        expected_date: '2026-10-20',
        change_deadline: '2026-10-18',
        items: [{ food_master_id: 'fm_sample_stock', quantity: 3 }],
      },
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: '入荷予定を保存しました。' }],
      structuredContent: {
        delivery_id: 'dly_sample',
        source_ref: 'sample-order',
        status: 'planned',
        expected_date: '2026-10-20',
        received_date: null,
        change_deadline: '2026-10-18',
        items: [
          {
            food_master_id: 'fm_sample_stock',
            food_name: 'Sample stock food',
            quantity: 3,
          },
        ],
      },
    })
  } finally {
    await h.close()
  }
})

it('routes receive_delivery actual quantities', async () => {
  const receiveInputs: ReceiveDeliveryInput[] = []
  const h = await connect(
    createStockServiceStub({}, undefined, undefined, (input) =>
      receiveInputs.push(input),
    ),
  )
  try {
    await h.client.callTool({
      name: 'receive_delivery',
      arguments: {
        delivery_id: 'dly_sample',
        received_date: '2026-10-21',
        items: [{ food_master_id: 'fm_sample_stock', quantity: 2 }],
      },
    })

    expect(receiveInputs).toEqual([
      {
        deliveryId: 'dly_sample',
        receivedDate: '2026-10-21',
        items: [{ foodMasterId: 'fm_sample_stock', quantity: 2 }],
      },
    ])
  } finally {
    await h.close()
  }
})

it('returns the saved receive_delivery payload', async () => {
  const delivery: Delivery = {
    id: 'dly_sample',
    sourceRef: 'sample-order',
    status: 'received',
    expectedDate: '2026-10-20',
    receivedDate: '2026-10-21',
    changeDeadline: '2026-10-18',
    items: [
      {
        foodMasterId: 'fm_sample_stock',
        foodName: 'Sample stock food',
        quantity: 2,
      },
    ],
  }
  const h = await connect(createStockServiceStub({ delivery }))
  try {
    const result = await h.client.callTool({
      name: 'receive_delivery',
      arguments: {
        delivery_id: 'dly_sample',
        received_date: '2026-10-21',
        items: [{ food_master_id: 'fm_sample_stock', quantity: 2 }],
      },
    })

    expect(result).toEqual({
      content: [{ type: 'text', text: '配送の受領を保存しました。' }],
      structuredContent: {
        delivery_id: 'dly_sample',
        source_ref: 'sample-order',
        status: 'received',
        expected_date: '2026-10-20',
        received_date: '2026-10-21',
        change_deadline: '2026-10-18',
        items: [
          {
            food_master_id: 'fm_sample_stock',
            food_name: 'Sample stock food',
            quantity: 2,
          },
        ],
      },
    })
  } finally {
    await h.close()
  }
})

it('returns lot level stock status and planned deliveries', async () => {
  const h = await connect(
    createStockServiceStub({
      status: {
        stockItems: [
          {
            foodMasterId: 'fm_status',
            foodName: 'Sample food status',
            storageLocationId: 'sl_status',
            storageLocation: { name: 'Sample shelf', capacity: 6 },
            eatWithinDays: 14,
            totalQuantity: 2.5,
            lots: [
              {
                id: 'stl_status',
                quantity: 2,
                remainingQuantity: 1.5,
                receivedDate: '2026-10-01',
                bestBefore: '2026-11-01',
                eatBy: '2026-10-15',
              },
              {
                id: 'stl_undated_status',
                quantity: 1,
                remainingQuantity: 1,
                receivedDate: null,
                bestBefore: null,
                eatBy: null,
              },
            ],
          },
        ],
        plannedDeliveries: [
          {
            id: 'dly_planned',
            sourceRef: 'sample-order',
            expectedDate: '2026-10-20',
            changeDeadline: '2026-10-18',
            items: [
              {
                foodMasterId: 'fm_status',
                foodName: 'Sample food status',
                quantity: 2,
              },
            ],
          },
        ],
        capacityWarnings: [
          {
            id: 'capacity-overflow:sl_status:2026-10-20',
            storageLocationId: 'sl_status',
            storageLocationName: 'Sample shelf',
            expectedDate: '2026-10-20',
            deliveries: [
              {
                deliveryId: 'dly_planned',
                changeDeadline: '2026-10-18',
              },
            ],
            projectedQuantity: 8,
            capacity: 6,
            excessQuantity: 2,
          },
        ],
        eatByWarnings: [
          {
            id: 'eat-by-risk:stl_status:2026-10-15:deadline_passed',
            riskType: 'deadline_passed',
            stockLotId: 'stl_status',
            foodMasterId: 'fm_status',
            foodName: 'Sample food status',
            targetDate: '2026-10-15',
            targetDateType: 'eat_by',
            remainingQuantity: 1.5,
            quantityUsedForRate: null,
            daysUntilTarget: null,
            requiredDailyConsumption: null,
            actualDailyConsumption: 0,
          },
        ],
        priorityLots: [
          {
            foodMasterId: 'fm_status',
            foodName: 'Sample food status',
            stockLotId: 'stl_status',
            remainingQuantity: 1.5,
            targetDate: '2026-10-15',
            reasons: ['eat_by', 'deadline_passed'],
          },
          {
            foodMasterId: 'fm_status',
            foodName: 'Sample food status',
            stockLotId: 'stl_undated_status',
            remainingQuantity: 1,
            targetDate: null,
            reasons: ['oldest_received'],
          },
        ],
      },
    }),
  )
  try {
    const result = await h.client.callTool({
      name: 'get_stock_status',
      arguments: {},
    })

    expect(result).toEqual({
      content: [
        {
          type: 'text',
          text: '1 件の在庫状況と 1 件の入荷予定を取得しました。',
        },
      ],
      structuredContent: {
        stock_items: [
          {
            food_master_id: 'fm_status',
            food_name: 'Sample food status',
            total_quantity: 2.5,
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
              {
                stock_lot_id: 'stl_undated_status',
                quantity: 1,
                remaining_quantity: 1,
                received_date: null,
                best_before: null,
                eat_by: null,
              },
            ],
          },
        ],
        planned_deliveries: [
          {
            delivery_id: 'dly_planned',
            source_ref: 'sample-order',
            expected_date: '2026-10-20',
            change_deadline: '2026-10-18',
            items: [
              {
                food_master_id: 'fm_status',
                food_name: 'Sample food status',
                quantity: 2,
              },
            ],
          },
        ],
        capacity_warnings: [
          {
            id: 'capacity-overflow:sl_status:2026-10-20',
            storage_location_id: 'sl_status',
            storage_location_name: 'Sample shelf',
            expected_date: '2026-10-20',
            deliveries: [
              {
                delivery_id: 'dly_planned',
                change_deadline: '2026-10-18',
              },
            ],
            projected_quantity: 8,
            capacity: 6,
            excess_quantity: 2,
          },
        ],
        eat_by_warnings: [
          {
            id: 'eat-by-risk:stl_status:2026-10-15:deadline_passed',
            risk_type: 'deadline_passed',
            stock_lot_id: 'stl_status',
            food_master_id: 'fm_status',
            food_name: 'Sample food status',
            target_date: '2026-10-15',
            target_date_type: 'eat_by',
            remaining_quantity: 1.5,
            quantity_used_for_rate: null,
            days_until_target: null,
            required_daily_consumption: null,
            actual_daily_consumption: 0,
          },
        ],
        priority_lots: [
          {
            food_master_id: 'fm_status',
            food_name: 'Sample food status',
            stock_lot_id: 'stl_status',
            remaining_quantity: 1.5,
            target_date: '2026-10-15',
            reasons: ['eat_by', 'deadline_passed'],
          },
          {
            food_master_id: 'fm_status',
            food_name: 'Sample food status',
            stock_lot_id: 'stl_undated_status',
            remaining_quantity: 1,
            target_date: null,
            reasons: ['oldest_received'],
          },
        ],
      },
    })
  } finally {
    await h.close()
  }
})
