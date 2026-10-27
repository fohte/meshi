import { randomUUID } from 'node:crypto'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { beforeEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import type { Sql } from '#db/index'
import { upsertNutrientDefinitions } from '#db/seed/nutrient-definitions'
import { createFoodSearchService } from '#domain/food-browse/index'
import type { IdGenerator } from '#domain/food-master/id'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '#domain/food-master/index'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { createMealHistoryService } from '#domain/meal-history/index'
import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type { MealType } from '#domain/meal-log/types'
import {
  createDrizzleMealSetRepository,
  createMealSetService,
} from '#domain/meal-set/index'
import { createDrizzleMealSkipRepository } from '#domain/meal-skip/drizzle-meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import { createDrizzleStockRepository } from '#domain/stock/drizzle-stock-repository'
import { createStockService } from '#domain/stock/stock-service'
import { createUserProfileService } from '#domain/user-profile/user-profile-service'
import { createMcpServer } from '#mcp'
import {
  deliveryStructuredOutput,
  listDeliveriesStructuredOutput,
  updateDeliverySourceRefStructuredOutput,
} from '#mcp-tools/delivery-schemas'
import {
  addDrizzleNestedTransactions,
  describeIfDb,
  getTestSql,
  setupTx,
} from '#test/db'
import { jstDate } from '#test/jst-date'
import { createNullLogger } from '#test/logger'
import {
  seedDelivery,
  seedFoodMaster as seedFoodMasterRow,
  seedFoodMasterWithoutNutrition as seedFoodMasterWithoutNutritionRow,
  seedMealLog as seedMealLogRow,
  seedStockItem,
  seedStockLot,
  seedStockMovement,
} from '#test/seed'

const observation = <T extends object>(value: T): T => value
const VALIDATION_ERROR_TEXT = '<schema validation error>'

// harness -----------------------------------------------------------------

interface Harness {
  readonly client: Client
  readonly close: () => Promise<void>
}

interface HarnessOptions {
  readonly tx: Sql
  readonly stockIdGenerator?: IdGenerator
}

const readOptions = (sql: Sql): unknown => Reflect.get(sql, 'options')

// Borrow the pool's options onto ReservedSql so drizzle can mutate the
// jsonb/timestamp serializers it needs at construction time.
const prepareTxForDrizzle = (tx: Sql): Sql => {
  if (readOptions(tx) === undefined) {
    Object.defineProperty(tx, 'options', {
      value: readOptions(getTestSql()),
      configurable: true,
      writable: true,
    })
  }
  return addDrizzleNestedTransactions(tx)
}

interface OptionsBag {
  readonly serializers: Record<string, (v: unknown) => unknown>
  readonly parsers: Record<string, (v: unknown) => unknown>
}

const TIMESTAMP_OIDS = ['1184', '1114'] as const

const snapshotTimestampHandlers = (
  tx: Sql,
): {
  serializers: Record<string, (v: unknown) => unknown>
  parsers: Record<string, (v: unknown) => unknown>
} => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tx.options is the shared pool options at this point.
  const opts = (tx as unknown as { options: OptionsBag }).options
  const serializers: Record<string, (v: unknown) => unknown> = {}
  const parsers: Record<string, (v: unknown) => unknown> = {}
  for (const oid of TIMESTAMP_OIDS) {
    const s = opts.serializers[oid]
    const p = opts.parsers[oid]
    if (s !== undefined) serializers[oid] = s
    if (p !== undefined) parsers[oid] = p
  }
  return { serializers, parsers }
}

const restoreTimestampHandlers = (
  tx: Sql,
  snapshot: ReturnType<typeof snapshotTimestampHandlers>,
): void => {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- tx.options shape mirrors postgres-js's `options`.
  const opts = (tx as unknown as { options: OptionsBag }).options
  for (const oid of TIMESTAMP_OIDS) {
    const s = snapshot.serializers[oid]
    const p = snapshot.parsers[oid]
    if (s !== undefined) opts.serializers[oid] = s
    if (p !== undefined) opts.parsers[oid] = p
  }
}

const startHarness = async (opts: HarnessOptions): Promise<Harness> => {
  const tx = prepareTxForDrizzle(opts.tx)
  const timestampSnapshot = snapshotTimestampHandlers(tx)

  const foodMasterRepository = createFoodMasterRepository(tx, {
    // The outer per-test transaction already provides atomicity; postgres-js
    // rejects a nested BEGIN inside it.
    wrapInTransaction: false,
  })
  const foodMasterService = createFoodMasterService(foodMasterRepository)

  const mealLogRepository = createDrizzleMealLogRepository(tx, {
    wrapDeleteManyInTransaction: false,
  })
  const mealLogService = createMealLogService({
    repository: mealLogRepository,
    foodMasterService,
    idGenerator: () => randomUUID(),
    // pin to a fixed point in time so eaten_date validation is deterministic
    now: () => new Date('2026-06-12T22:00:00+09:00'),
  })
  const mealSkipService = createMealSkipService({
    repository: createDrizzleMealSkipRepository(tx),
    idGenerator: () => randomUUID(),
    now: () => new Date('2026-06-12T22:00:00+09:00'),
  })
  const mealSetService = createMealSetService({
    repository: createDrizzleMealSetRepository(tx, {
      wrapInTransaction: false,
    }),
    idGenerator: () => randomUUID(),
  })
  const stockService = createStockService(
    createDrizzleStockRepository(tx, {
      ...(opts.stockIdGenerator === undefined
        ? {}
        : { generateId: opts.stockIdGenerator }),
      wrapInTransaction: false,
    }),
  )
  const foodMatcher = createDrizzleFoodMatcher(tx)
  const foodSearchService = createFoodSearchService(tx, foodMatcher)
  const mealHistoryService = createMealHistoryService(tx)
  const userProfileService = createUserProfileService(
    createDrizzleUserProfileRepository(tx),
  )
  // Production code uses raw `tx\`... ${date}\`` binds and z.date() on
  // results; drizzle's constructor flips the timestamp handlers to identity,
  // so restore them.
  restoreTimestampHandlers(tx, timestampSnapshot)
  const server = createMcpServer({
    mealHistoryService,
    profileService: userProfileService,
    foodSearchService,
    mealLogService,
    mealSkipService,
    mealSetService,
    stockService,
    foodMasterService,
    logger: createNullLogger(),
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({
    name: 'meshi-integration-test',
    version: '0.0.0',
  })
  await client.connect(clientTransport)

  return {
    client,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

// data helpers ------------------------------------------------------------

const seedFoodMaster = async (
  tx: Sql,
  args: {
    readonly id: string
    readonly name: string
    readonly isEstimated?: boolean
    readonly nutrition: Readonly<Record<string, number>>
  },
): Promise<void> => {
  await tx`
    INSERT INTO food_masters (id, name)
    VALUES (${args.id}, ${args.name})
  `
  await tx`
    INSERT INTO food_master_nutrition (food_master_id, is_estimated, source)
    VALUES (${args.id}, ${args.isEstimated ?? false}, 'user_input')
  `
  const rows = Object.entries(args.nutrition).map(([code, value]) => ({
    food_master_id: args.id,
    nutrient_code: code,
    value: String(value),
  }))
  if (rows.length > 0) {
    await tx`INSERT INTO food_master_nutrients ${tx(rows, 'food_master_id', 'nutrient_code', 'value')}`
  }
}

const seedMealLog = async (
  tx: Sql,
  args: {
    readonly id: string
    readonly foodMasterId: string
    readonly eatenDate: string
    readonly mealType: MealType
    readonly quantity: number
    readonly createdAt?: Date
  },
): Promise<void> => {
  await tx`
    INSERT INTO meal_logs (id, food_master_id, eaten_date, meal_type, quantity, created_at)
    VALUES (
      ${args.id},
      ${args.foodMasterId},
      ${args.eatenDate},
      ${args.mealType},
      ${String(args.quantity)},
      COALESCE(${args.createdAt ?? null}::timestamptz, now())
    )
  `
}

// Loosely-typed envelope: MCP's CallTool return is a union that includes a
// legacy `toolResult` branch without `content`, but in this codebase the
// server always returns the `content`-bearing shape — narrow with a runtime
// schema instead of fighting the union at the type level.
const toolResultSchema = z.object({
  isError: z.boolean().optional(),
  structuredContent: z.unknown().optional(),
  content: z.array(
    z
      .object({
        type: z.string(),
        text: z.string().optional(),
      })
      .loose(),
  ),
})

type NormalizedToolResult = z.infer<typeof toolResultSchema>

const normalizeResult = (raw: unknown): NormalizedToolResult =>
  toolResultSchema.parse(raw)

const normalizeValidationErrorResult = (raw: unknown): NormalizedToolResult => {
  const result = normalizeResult(raw)
  return {
    ...result,
    content: result.content.map((content) =>
      content.type === 'text'
        ? { ...content, text: VALIDATION_ERROR_TEXT }
        : content,
    ),
  }
}

const NORMALIZED_HISTORY_TIMESTAMP = '2001-01-01T00:00:00.000Z'

type ListedDeliveryPayload = z.infer<
  typeof updateDeliverySourceRefStructuredOutput
>

const normalizeListedDeliveryHistory = (
  delivery: ListedDeliveryPayload,
): ListedDeliveryPayload => ({
  ...delivery,
  source_ref_history: delivery.source_ref_history.map((entry) => ({
    ...entry,
    created_at: NORMALIZED_HISTORY_TIMESTAMP,
  })),
})

const normalizeListDeliveriesResult = (raw: unknown): NormalizedToolResult => {
  const result = normalizeResult(raw)
  const output = listDeliveriesStructuredOutput.parse(result.structuredContent)
  return {
    ...result,
    structuredContent: {
      deliveries: output.deliveries.map(normalizeListedDeliveryHistory),
    },
  }
}

const normalizeUpdateDeliverySourceRefResult = (
  raw: unknown,
): NormalizedToolResult => {
  const result = normalizeResult(raw)
  const output = updateDeliverySourceRefStructuredOutput.parse(
    result.structuredContent,
  )
  return {
    ...result,
    structuredContent: normalizeListedDeliveryHistory(output),
  }
}

const deliveryDatabaseSnapshotSchema = z.object({
  deliveries: z.array(
    z.object({
      id: z.string(),
      source_ref: z.string().nullable(),
      status: z.enum(['planned', 'received', 'cancelled']),
      expected_date: z.iso.date(),
      received_date: z.iso.date().nullable(),
      change_deadline: z.iso.date().nullable(),
      created_at: z.string(),
    }),
  ),
  sourceRefs: z.array(
    z.object({
      source_ref: z.string(),
      delivery_id: z.string(),
      created_at: z.string(),
    }),
  ),
  stockLots: z.array(
    z.object({
      id: z.string(),
      food_master_id: z.string(),
      delivery_id: z.string().nullable(),
      quantity: z.string(),
      received_date: z.iso.date().nullable(),
      best_before: z.iso.date().nullable(),
      eat_by: z.iso.date().nullable(),
      created_at: z.string(),
    }),
  ),
  stockMovements: z.array(
    z.object({
      id: z.string(),
      stock_lot_id: z.string(),
      delta: z.string(),
      reason: z.enum(['receive', 'meal', 'count']),
      note: z.string().nullable(),
      meal_log_id: z.string().nullable(),
      created_at: z.string(),
    }),
  ),
  mealLogs: z.array(
    z.object({
      id: z.string(),
      food_master_id: z.string(),
      eaten_date: z.iso.date(),
      meal_type: z.string(),
      quantity: z.string(),
      created_at: z.string(),
    }),
  ),
})

type DeliveryDatabaseSnapshot = z.infer<typeof deliveryDatabaseSnapshotSchema>

const readDeliveryDatabaseSnapshot = async (
  tx: Sql,
): Promise<DeliveryDatabaseSnapshot> =>
  deliveryDatabaseSnapshotSchema.parse({
    deliveries: await tx<Record<string, unknown>[]>`
      SELECT id, source_ref, status::text AS status,
             expected_date::text AS expected_date,
             received_date::text AS received_date,
             change_deadline::text AS change_deadline,
             created_at::text AS created_at
      FROM deliveries
      ORDER BY id
    `,
    sourceRefs: await tx<Record<string, unknown>[]>`
      SELECT source_ref, delivery_id, created_at::text AS created_at
      FROM delivery_source_refs
      ORDER BY delivery_id, created_at, source_ref
    `,
    stockLots: await tx<Record<string, unknown>[]>`
      SELECT id, food_master_id, delivery_id, quantity::text AS quantity,
             received_date::text AS received_date,
             best_before::text AS best_before, eat_by::text AS eat_by,
             created_at::text AS created_at
      FROM stock_lots
      ORDER BY id
    `,
    stockMovements: await tx<Record<string, unknown>[]>`
      SELECT sm.id, sm.stock_lot_id, sm.delta::text AS delta, sm.reason,
             sm.note, sm.meal_log_id, sm.created_at::text AS created_at
      FROM stock_movements sm
      ORDER BY sm.id
    `,
    mealLogs: await tx<Record<string, unknown>[]>`
      SELECT id, food_master_id, eaten_date::text AS eaten_date, meal_type,
             quantity::text AS quantity, created_at::text AS created_at
      FROM meal_logs
      ORDER BY id
    `,
  })

const inventorySnapshot = (snapshot: DeliveryDatabaseSnapshot) => ({
  deliveries: snapshot.deliveries.map((delivery) => ({
    id: delivery.id,
    status: delivery.status,
    expected_date: delivery.expected_date,
    received_date: delivery.received_date,
    change_deadline: delivery.change_deadline,
    created_at: delivery.created_at,
  })),
  stockLots: snapshot.stockLots,
  stockMovements: snapshot.stockMovements,
  mealLogs: snapshot.mealLogs,
})

const seedDeliverySourceRefCorrectionScenario = async (
  tx: Sql,
): Promise<{
  readonly foodMasterId: string
  readonly partialDeliveryId: string
  readonly completeDeliveryId: string
  readonly partialOldSourceRef: string
  readonly partialNewSourceRef: string
  readonly completeOldSourceRef: string
  readonly completeNewSourceRef: string
  readonly partialMealLogId: string
  readonly completeMealLogId: string
}> => {
  const foodMasterId = 'fm_delivery_ref_correction_sample'
  const partialDeliveryId = 'dly_ref_correction_partial'
  const completeDeliveryId = 'dly_ref_correction_complete'
  const partialOldSourceRef = 'ref_zeta_partial_original'
  const partialNewSourceRef = 'ref_alpha_partial_corrected'
  const completeOldSourceRef = 'ref_zeta_complete_original'
  const completeNewSourceRef = 'ref_alpha_complete_corrected'
  const partialMealLogId = 'ml_ref_correction_partial'
  const completeMealLogId = 'ml_ref_correction_complete'

  await seedFoodMasterWithoutNutritionRow(tx, {
    id: foodMasterId,
    name: 'Sample delivery food',
  })
  await seedStockItem(tx, { foodMasterId })
  await seedDelivery(tx, {
    id: partialDeliveryId,
    sourceRef: partialOldSourceRef,
    status: 'received',
    expectedDate: '2031-07-01',
    receivedDate: '2031-07-02',
  })
  await seedDelivery(tx, {
    id: completeDeliveryId,
    sourceRef: completeOldSourceRef,
    status: 'received',
    expectedDate: '2031-07-03',
    receivedDate: '2031-07-04',
  })
  await seedStockLot(tx, {
    id: 'stl_ref_correction_partial',
    foodMasterId,
    deliveryId: partialDeliveryId,
    quantity: 5,
    receivedDate: '2031-07-02',
  })
  await seedStockLot(tx, {
    id: 'stl_ref_correction_complete',
    foodMasterId,
    deliveryId: completeDeliveryId,
    quantity: 4,
    receivedDate: '2031-07-04',
  })
  await seedMealLogRow(tx, {
    id: partialMealLogId,
    foodMasterId,
    eatenDate: jstDate('2031-07-03'),
    mealType: 'lunch',
    quantity: 2,
  })
  await seedMealLogRow(tx, {
    id: completeMealLogId,
    foodMasterId,
    eatenDate: jstDate('2031-07-05'),
    mealType: 'lunch',
    quantity: 4,
  })
  await seedStockMovement(tx, {
    id: 'stm_ref_correction_partial_receive',
    stockLotId: 'stl_ref_correction_partial',
    delta: 5,
    reason: 'receive',
  })
  await seedStockMovement(tx, {
    id: 'stm_ref_correction_partial_meal',
    stockLotId: 'stl_ref_correction_partial',
    delta: -2,
    reason: 'meal',
    mealLogId: partialMealLogId,
  })
  await seedStockMovement(tx, {
    id: 'stm_ref_correction_complete_receive',
    stockLotId: 'stl_ref_correction_complete',
    delta: 4,
    reason: 'receive',
  })
  await seedStockMovement(tx, {
    id: 'stm_ref_correction_complete_meal',
    stockLotId: 'stl_ref_correction_complete',
    delta: -4,
    reason: 'meal',
    mealLogId: completeMealLogId,
  })

  return {
    foodMasterId,
    partialDeliveryId,
    completeDeliveryId,
    partialOldSourceRef,
    partialNewSourceRef,
    completeOldSourceRef,
    completeNewSourceRef,
    partialMealLogId,
    completeMealLogId,
  }
}

// scenarios ----------------------------------------------------------------

describeIfDb('meshi integration', () => {
  const getTx = setupTx()

  beforeEach(async () => {
    await upsertNutrientDefinitions(getTx(), [
      {
        code: 'energy_kcal',
        displayName: 'energy',
        unit: 'kcal',
        isMajor: true,
        sortOrder: 1,
      },
      {
        code: 'protein_g',
        displayName: 'protein',
        unit: 'g',
        isMajor: true,
        sortOrder: 2,
      },
      {
        code: 'fat_g',
        displayName: 'fat',
        unit: 'g',
        isMajor: true,
        sortOrder: 3,
      },
      {
        code: 'carbohydrate_g',
        displayName: 'carb',
        unit: 'g',
        isMajor: true,
        sortOrder: 4,
      },
    ])
  })

  it('queries meal history over a period', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      nutrition: { energy_kcal: 168, protein_g: 2.5, carbohydrate_g: 37 },
    })
    await seedMealLog(tx, {
      id: 'ml_history_1',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-12',
      mealType: 'lunch',
      quantity: 2,
      createdAt: new Date('2026-06-12T03:30:45.789Z'),
    })

    const harness = await startHarness({ tx })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'query_meals',
          arguments: {
            period_from: '2026-06-12',
            period_to: '2026-06-13',
          },
        }),
      )

      expect(result).toEqual({
        structuredContent: {
          totals: {
            energy_kcal: 336,
            protein_g: 5,
            carbohydrate_g: 74,
          },
          incomplete_nutrients: ['fat_g'],
          per_day: [
            {
              date: '2026-06-12',
              totals: {
                energy_kcal: 336,
                protein_g: 5,
                carbohydrate_g: 74,
              },
              incomplete_nutrients: ['fat_g'],
              has_unknown_values: false,
            },
          ],
          entries: [
            {
              meal_log_id: 'ml_history_1',
              food_master_id: 'fm_rice',
              food_name: '白米',
              eaten_date: '2026-06-12',
              meal_type: 'lunch',
              quantity: 2,
              recorded_at: '2026-06-12T03:30:45Z',
              nutrition_status: 'confirmed',
            },
          ],
          has_estimated_values: false,
          has_unknown_values: false,
        },
        content: [
          {
            type: 'text',
            text: '食事履歴を取得しました。',
          },
        ],
      })
    } finally {
      await harness.close()
    }
  })

  it('includes earlier meal logs after filling their food nutrition', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutritionRow(tx, {
      id: 'fm_pending_alpha',
      name: 'sample takeaway bowl',
    })
    await seedMealLogRow(tx, {
      id: 'ml_pending_alpha',
      foodMasterId: 'fm_pending_alpha',
      eatenDate: jstDate('2026-06-12'),
      mealType: 'lunch',
      quantity: 1.5,
      createdAt: new Date('2026-06-12T03:30:45.000Z'),
    })

    const harness = await startHarness({ tx })

    try {
      const fillResult = normalizeResult(
        await harness.client.callTool({
          name: 'fill_food_nutrition',
          arguments: {
            food_master_id: 'fm_pending_alpha',
            nutrition: { energy_kcal: 240, protein_g: 12 },
            source: 'web_search',
            is_estimated: false,
            source_url: 'https://example.test/items/sample-bowl',
          },
        }),
      )
      const queryResult = normalizeResult(
        await harness.client.callTool({
          name: 'query_meals',
          arguments: {
            period_from: '2026-06-12',
            period_to: '2026-06-13',
          },
        }),
      )

      expect(observation({ fillResult, queryResult })).toEqual({
        fillResult: {
          content: [{ type: 'text', text: '食品の栄養値を補完しました。' }],
          structuredContent: {
            food_master_id: 'fm_pending_alpha',
            nutrition_status: 'confirmed',
          },
        },
        queryResult: {
          structuredContent: {
            totals: { energy_kcal: 360, protein_g: 18 },
            incomplete_nutrients: ['carbohydrate_g', 'fat_g'],
            per_day: [
              {
                date: '2026-06-12',
                totals: { energy_kcal: 360, protein_g: 18 },
                incomplete_nutrients: ['carbohydrate_g', 'fat_g'],
                has_unknown_values: false,
              },
            ],
            entries: [
              {
                meal_log_id: 'ml_pending_alpha',
                food_master_id: 'fm_pending_alpha',
                food_name: 'sample takeaway bowl',
                eaten_date: '2026-06-12',
                meal_type: 'lunch',
                quantity: 1.5,
                recorded_at: '2026-06-12T03:30:45Z',
                nutrition_status: 'confirmed',
              },
            ],
            has_estimated_values: false,
            has_unknown_values: false,
          },
          content: [{ type: 'text', text: '食事履歴を取得しました。' }],
        },
      })
    } finally {
      await harness.close()
    }
  })

  it('registers a food without nutrition, records it, and queries unknown status', async () => {
    const tx = getTx()
    const harness = await startHarness({ tx })

    try {
      const registration = normalizeResult(
        await harness.client.callTool({
          name: 'register_food_without_nutrition',
          arguments: {
            name: 'Example Bistro tasting plate',
            aliases: ['Example Bistro sampler'],
          },
        }),
      )
      const registeredFood = z
        .object({ food_master_id: z.string(), name: z.string() })
        .parse(registration.structuredContent)

      const recording = normalizeResult(
        await harness.client.callTool({
          name: 'record_meal_log',
          arguments: {
            date: '2026-06-12',
            meal_type: 'dinner',
            items: [
              {
                food_master_id: registeredFood.food_master_id,
                food_name: registeredFood.name,
                quantity: 2,
              },
            ],
          },
        }),
      )
      const recordedItems = z
        .object({
          recorded: z.array(
            z.object({
              meal_log_id: z.string(),
              food_master_id: z.string(),
              food_name: z.string(),
              quantity: z.number(),
              nutrition: z.record(z.string(), z.number()),
              is_estimated: z.boolean(),
              nutrition_status: z.enum(['confirmed', 'estimated', 'unknown']),
              stock_shortfall: z.number().nullable(),
            }),
          ),
          error: z.null(),
        })
        .parse(recording.structuredContent)

      const query = normalizeResult(
        await harness.client.callTool({
          name: 'query_meals',
          arguments: {
            period_from: '2026-06-12',
            period_to: '2026-06-13',
          },
        }),
      )
      const queryData = z
        .object({
          totals: z.record(z.string(), z.number()),
          incomplete_nutrients: z.array(z.string()),
          per_day: z.array(
            z.object({
              date: z.string(),
              totals: z.record(z.string(), z.number()),
              incomplete_nutrients: z.array(z.string()),
              has_unknown_values: z.boolean(),
            }),
          ),
          entries: z.array(
            z.object({
              meal_log_id: z.string(),
              food_master_id: z.string(),
              food_name: z.string(),
              eaten_date: z.string(),
              meal_type: z.string(),
              quantity: z.number(),
              recorded_at: z.string(),
              nutrition_status: z.enum(['confirmed', 'estimated', 'unknown']),
            }),
          ),
          has_estimated_values: z.boolean(),
          has_unknown_values: z.boolean(),
        })
        .parse(query.structuredContent)

      expect(
        observation({
          registration: {
            ...registration,
            structuredContent: {
              ...registeredFood,
              food_master_id: '<food_master_id>',
            },
          },
          recording: {
            ...recording,
            structuredContent: {
              recorded: recordedItems.recorded.map((item) => ({
                ...item,
                meal_log_id: '<meal_log_id>',
                food_master_id: '<food_master_id>',
              })),
              error: recordedItems.error,
            },
          },
          query: {
            ...query,
            structuredContent: {
              ...queryData,
              entries: queryData.entries.map((entry) => ({
                ...entry,
                meal_log_id: '<meal_log_id>',
                food_master_id: '<food_master_id>',
                recorded_at: '<recorded_at>',
              })),
            },
          },
        }),
      ).toEqual({
        registration: {
          content: [{ type: 'text', text: '食品を登録しました。' }],
          structuredContent: {
            food_master_id: '<food_master_id>',
            name: 'Example Bistro tasting plate',
          },
        },
        recording: {
          content: [{ type: 'text', text: '1 品目を記録しました。' }],
          structuredContent: {
            recorded: [
              {
                meal_log_id: '<meal_log_id>',
                food_master_id: '<food_master_id>',
                food_name: 'Example Bistro tasting plate',
                quantity: 2,
                nutrition: {},
                is_estimated: false,
                nutrition_status: 'unknown',
                stock_shortfall: null,
              },
            ],
            error: null,
          },
        },
        query: {
          content: [{ type: 'text', text: '食事履歴を取得しました。' }],
          structuredContent: {
            totals: {},
            incomplete_nutrients: [
              'carbohydrate_g',
              'energy_kcal',
              'fat_g',
              'protein_g',
            ],
            per_day: [
              {
                date: '2026-06-12',
                totals: {},
                incomplete_nutrients: [
                  'carbohydrate_g',
                  'energy_kcal',
                  'fat_g',
                  'protein_g',
                ],
                has_unknown_values: true,
              },
            ],
            entries: [
              {
                meal_log_id: '<meal_log_id>',
                food_master_id: '<food_master_id>',
                food_name: 'Example Bistro tasting plate',
                eaten_date: '2026-06-12',
                meal_type: 'dinner',
                quantity: 2,
                recorded_at: '<recorded_at>',
                nutrition_status: 'unknown',
              },
            ],
            has_estimated_values: false,
            has_unknown_values: true,
          },
        },
      })
    } finally {
      await harness.close()
    }
  })

  it('reflects meal log updates and deletions in query_meals', async () => {
    const tx = getTx()
    await seedFoodMasterRow(tx, {
      id: 'mcp_fixture_food_alpha',
      name: '試験用食品 A',
      source: 'user_input',
      nutrients: { energy_kcal: 137, protein_g: 5 },
    })
    await seedFoodMasterRow(tx, {
      id: 'mcp_fixture_food_beta',
      name: '試験用食品 B',
      source: 'user_input',
      nutrients: { energy_kcal: 89, protein_g: 3 },
    })
    await seedMealLogRow(tx, {
      id: 'mcp_fixture_meal_alpha',
      foodMasterId: 'mcp_fixture_food_alpha',
      eatenDate: jstDate('2026-04-17'),
      mealType: 'breakfast',
      quantity: 1,
      createdAt: new Date('2026-04-17T03:30:00.000Z'),
    })
    await seedMealLogRow(tx, {
      id: 'mcp_fixture_meal_beta',
      foodMasterId: 'mcp_fixture_food_beta',
      eatenDate: jstDate('2026-04-17'),
      mealType: 'lunch',
      quantity: 2,
      createdAt: new Date('2026-04-17T04:30:00.000Z'),
    })

    const harness = await startHarness({ tx })

    try {
      const updateResult = normalizeResult(
        await harness.client.callTool({
          name: 'update_meal_log',
          arguments: {
            meal_log_id: 'mcp_fixture_meal_alpha',
            quantity: 3,
            meal_type: 'dinner',
          },
        }),
      )

      const deleteResult = normalizeResult(
        await harness.client.callTool({
          name: 'delete_meal_log',
          arguments: { meal_log_ids: ['mcp_fixture_meal_beta'] },
        }),
      )

      const queryResult = normalizeResult(
        await harness.client.callTool({
          name: 'query_meals',
          arguments: {
            period_from: '2026-04-17',
            period_to: '2026-04-18',
          },
        }),
      )
      expect(observation({ updateResult, deleteResult, queryResult })).toEqual({
        updateResult: {
          content: [{ type: 'text', text: '食事ログを更新しました。' }],
          structuredContent: {
            meal_log_id: 'mcp_fixture_meal_alpha',
            food_master_id: 'mcp_fixture_food_alpha',
            food_name: '試験用食品 A',
            eaten_date: '2026-04-17',
            meal_type: 'dinner',
            quantity: 3,
            nutrition: { energy_kcal: 411, protein_g: 15 },
            is_estimated: false,
            stock_shortfall: null,
          },
        },
        deleteResult: {
          content: [{ type: 'text', text: '1 件の食事ログを削除しました。' }],
          structuredContent: {
            deleted: [
              {
                meal_log_id: 'mcp_fixture_meal_beta',
                food_master_id: 'mcp_fixture_food_beta',
                food_name: '試験用食品 B',
                eaten_date: '2026-04-17',
                meal_type: 'lunch',
                quantity: 2,
              },
            ],
          },
        },
        queryResult: {
          content: [{ type: 'text', text: '食事履歴を取得しました。' }],
          structuredContent: {
            totals: { energy_kcal: 411, protein_g: 15 },
            incomplete_nutrients: ['carbohydrate_g', 'fat_g'],
            per_day: [
              {
                date: '2026-04-17',
                totals: { energy_kcal: 411, protein_g: 15 },
                incomplete_nutrients: ['carbohydrate_g', 'fat_g'],
                has_unknown_values: false,
              },
            ],
            entries: [
              {
                meal_log_id: 'mcp_fixture_meal_alpha',
                food_master_id: 'mcp_fixture_food_alpha',
                food_name: '試験用食品 A',
                eaten_date: '2026-04-17',
                meal_type: 'dinner',
                quantity: 3,
                recorded_at: '2026-04-17T03:30:00Z',
                nutrition_status: 'confirmed',
              },
            ],
            has_estimated_values: false,
            has_unknown_values: false,
          },
        },
      })
    } finally {
      await harness.close()
    }
  })

  it('profile CRUD — update_profile then get_profile reflects the patch', async () => {
    const tx = getTx()
    const harness = await startHarness({ tx })

    try {
      const updated = normalizeResult(
        await harness.client.callTool({
          name: 'update_profile',
          arguments: {
            likes: ['和食'],
            allergies: ['そば'],
            daily_targets: { energy_kcal: 2200 },
          },
        }),
      )

      expect(updated).toEqual({
        content: [{ type: 'text', text: 'プロファイルを更新しました。' }],
        structuredContent: {
          likes: ['和食'],
          dislikes: [],
          allergies: ['そば'],
          constraints: [],
          daily_targets: { energy_kcal: 2200 },
        },
      })

      const fetched = normalizeResult(
        await harness.client.callTool({
          name: 'get_profile',
          arguments: {},
        }),
      )

      expect(fetched).toEqual({
        content: [{ type: 'text', text: 'プロファイルを取得しました。' }],
        structuredContent: {
          likes: ['和食'],
          dislikes: [],
          allergies: ['そば'],
          constraints: [],
          daily_targets: { energy_kcal: 2200 },
        },
      })

      const rows = await tx<
        {
          likes: string[]
          allergies: string[]
          daily_targets: Record<string, number>
        }[]
      >`SELECT likes, allergies, daily_targets FROM user_profiles WHERE id = 1`
      expect(rows).toEqual([
        {
          likes: ['和食'],
          allergies: ['そば'],
          daily_targets: { energy_kcal: 2200 },
        },
      ])
    } finally {
      await harness.close()
    }
  })

  it('corrects a received delivery by id and keeps both references searchable', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const initial = normalizeListDeliveriesResult(
        await harness.client.callTool({
          name: 'list_deliveries',
          arguments: {
            source_ref: scenario.partialOldSourceRef,
            status: 'received',
          },
        }),
      )
      const updated = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialNewSourceRef,
          },
        }),
      )
      const afterCorrection = await readDeliveryDatabaseSnapshot(tx)
      const byOldSourceRef = normalizeListDeliveriesResult(
        await harness.client.callTool({
          name: 'list_deliveries',
          arguments: { source_ref: scenario.partialOldSourceRef },
        }),
      )
      const byNewSourceRef = normalizeListDeliveriesResult(
        await harness.client.callTool({
          name: 'list_deliveries',
          arguments: { source_ref: scenario.partialNewSourceRef },
        }),
      )
      const repeated = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialNewSourceRef,
          },
        }),
      )
      const afterRepeatedCorrection = await readDeliveryDatabaseSnapshot(tx)
      const oldReferenceReplay = normalizeResult(
        await harness.client.callTool({
          name: 'register_delivery',
          arguments: {
            source_ref: scenario.partialOldSourceRef,
            status: 'planned',
            expected_date: '2031-07-06',
            items: [{ food_master_id: scenario.foodMasterId, quantity: 1 }],
          },
        }),
      )
      const afterOldReferenceReplay = await readDeliveryDatabaseSnapshot(tx)

      const actual = {
        initial,
        updated,
        byOldSourceRef,
        byNewSourceRef,
        repeated,
        oldReferenceReplay,
        databaseAfterCorrection: afterCorrection,
        databaseAfterRepeatedCorrection: afterRepeatedCorrection,
        databaseAfterOldReferenceReplay: afterOldReferenceReplay,
      }
      const expected = {
        initial: {
          content: [{ type: 'text', text: '1 件の配送を取得しました。' }],
          structuredContent: {
            deliveries: [
              {
                delivery_id: scenario.partialDeliveryId,
                source_ref: scenario.partialOldSourceRef,
                source_ref_history: [
                  {
                    source_ref: scenario.partialOldSourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                ],
                status: 'received',
                expected_date: '2031-07-01',
                received_date: '2031-07-02',
                change_deadline: null,
                items: [
                  {
                    food_master_id: scenario.foodMasterId,
                    food_name: 'Sample delivery food',
                    stock_lot_id: 'stl_ref_correction_partial',
                    quantity: 5,
                    remaining_quantity: 3,
                  },
                ],
              },
            ],
          },
        },
        updated: {
          content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
          structuredContent: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialNewSourceRef,
            source_ref_history: [
              {
                source_ref: scenario.partialOldSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
              {
                source_ref: scenario.partialNewSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
            ],
            status: 'received',
            expected_date: '2031-07-01',
            received_date: '2031-07-02',
            change_deadline: null,
            items: [
              {
                food_master_id: scenario.foodMasterId,
                food_name: 'Sample delivery food',
                stock_lot_id: 'stl_ref_correction_partial',
                quantity: 5,
                remaining_quantity: 3,
              },
            ],
          },
        },
        byOldSourceRef: {
          content: [{ type: 'text', text: '1 件の配送を取得しました。' }],
          structuredContent: {
            deliveries: [
              {
                delivery_id: scenario.partialDeliveryId,
                source_ref: scenario.partialNewSourceRef,
                source_ref_history: [
                  {
                    source_ref: scenario.partialOldSourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                  {
                    source_ref: scenario.partialNewSourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                ],
                status: 'received',
                expected_date: '2031-07-01',
                received_date: '2031-07-02',
                change_deadline: null,
                items: [
                  {
                    food_master_id: scenario.foodMasterId,
                    food_name: 'Sample delivery food',
                    stock_lot_id: 'stl_ref_correction_partial',
                    quantity: 5,
                    remaining_quantity: 3,
                  },
                ],
              },
            ],
          },
        },
        byNewSourceRef: {
          content: [{ type: 'text', text: '1 件の配送を取得しました。' }],
          structuredContent: {
            deliveries: [
              {
                delivery_id: scenario.partialDeliveryId,
                source_ref: scenario.partialNewSourceRef,
                source_ref_history: [
                  {
                    source_ref: scenario.partialOldSourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                  {
                    source_ref: scenario.partialNewSourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                ],
                status: 'received',
                expected_date: '2031-07-01',
                received_date: '2031-07-02',
                change_deadline: null,
                items: [
                  {
                    food_master_id: scenario.foodMasterId,
                    food_name: 'Sample delivery food',
                    stock_lot_id: 'stl_ref_correction_partial',
                    quantity: 5,
                    remaining_quantity: 3,
                  },
                ],
              },
            ],
          },
        },
        repeated: {
          content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
          structuredContent: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialNewSourceRef,
            source_ref_history: [
              {
                source_ref: scenario.partialOldSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
              {
                source_ref: scenario.partialNewSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
            ],
            status: 'received',
            expected_date: '2031-07-01',
            received_date: '2031-07-02',
            change_deadline: null,
            items: [
              {
                food_master_id: scenario.foodMasterId,
                food_name: 'Sample delivery food',
                stock_lot_id: 'stl_ref_correction_partial',
                quantity: 5,
                remaining_quantity: 3,
              },
            ],
          },
        },
        oldReferenceReplay: {
          isError: true,
          content: [
            { type: 'text', text: 'received deliveries cannot be changed' },
          ],
        },
        databaseAfterCorrection: afterCorrection,
        databaseAfterRepeatedCorrection: afterCorrection,
        databaseAfterOldReferenceReplay: afterCorrection,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('validates received delivery items before rejecting changes', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const registration = normalizeResult(
        await harness.client.callTool({
          name: 'register_delivery',
          arguments: {
            source_ref: scenario.partialOldSourceRef,
            status: 'planned',
            expected_date: '2031-07-06',
            items: [
              { food_master_id: 'fm_delivery_ref_untracked', quantity: 1 },
            ],
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)
      const actual = { registration, before, after }
      const expected = {
        registration: {
          isError: true,
          content: [{ type: 'text', text: 'food_master is not a stock_item' }],
        },
        before,
        after: before,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('corrects a cancelled delivery without changing its status', async () => {
    const tx = getTx()
    const deliveryId = 'dly_ref_correction_cancelled'
    const originalSourceRef = 'ref_cancelled_original'
    const correctedSourceRef = 'ref_cancelled_corrected'
    await seedDelivery(tx, {
      id: deliveryId,
      sourceRef: originalSourceRef,
      status: 'cancelled',
      expectedDate: '2031-09-01',
    })
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const updated = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: deliveryId,
            source_ref: correctedSourceRef,
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)
      const actual = {
        updated,
        inventoryAfter: inventorySnapshot(after),
        sourceRefs: after.sourceRefs.map(({ source_ref, delivery_id }) => ({
          source_ref,
          delivery_id,
        })),
      }
      const expected = {
        updated: {
          content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
          structuredContent: {
            delivery_id: deliveryId,
            source_ref: correctedSourceRef,
            source_ref_history: [
              {
                source_ref: originalSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
              {
                source_ref: correctedSourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
            ],
            status: 'cancelled',
            expected_date: '2031-09-01',
            received_date: null,
            change_deadline: null,
            items: [],
          },
        },
        inventoryAfter: inventorySnapshot(before),
        sourceRefs: [
          { source_ref: originalSourceRef, delivery_id: deliveryId },
          { source_ref: correctedSourceRef, delivery_id: deliveryId },
        ],
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('adds a first reference to a delivery whose source reference is null', async () => {
    const tx = getTx()
    const deliveryId = 'dly_ref_correction_unreferenced'
    const sourceRef = 'ref_first_assignment'
    await seedDelivery(tx, {
      id: deliveryId,
      status: 'planned',
      expectedDate: '2031-10-01',
    })
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const updated = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: { delivery_id: deliveryId, source_ref: sourceRef },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)
      const actual = {
        updated,
        inventoryAfter: inventorySnapshot(after),
        sourceRefs: after.sourceRefs.map(({ source_ref, delivery_id }) => ({
          source_ref,
          delivery_id,
        })),
      }
      const expected = {
        updated: {
          content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
          structuredContent: {
            delivery_id: deliveryId,
            source_ref: sourceRef,
            source_ref_history: [
              {
                source_ref: sourceRef,
                created_at: NORMALIZED_HISTORY_TIMESTAMP,
              },
            ],
            status: 'planned',
            expected_date: '2031-10-01',
            received_date: null,
            change_deadline: null,
            items: [],
          },
        },
        inventoryAfter: inventorySnapshot(before),
        sourceRefs: [{ source_ref: sourceRef, delivery_id: deliveryId }],
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('registers a new reference in history when creating a delivery', async () => {
    const tx = getTx()
    const deliveryId = 'dly_new_registration'
    const stockLotId = 'stl_new_registration'
    const foodMasterId = 'fm_new_registration'
    const sourceRef = 'ref_new_registration'
    await seedFoodMasterWithoutNutritionRow(tx, {
      id: foodMasterId,
      name: 'Sample newly registered food',
    })
    await seedStockItem(tx, { foodMasterId })
    const harness = await startHarness({
      tx,
      stockIdGenerator: (prefix) => `${prefix}_new_registration`,
    })

    try {
      const registeredResult = normalizeResult(
        await harness.client.callTool({
          name: 'register_delivery',
          arguments: {
            source_ref: sourceRef,
            status: 'planned',
            expected_date: '2031-11-01',
            items: [{ food_master_id: foodMasterId, quantity: 3 }],
          },
        }),
      )
      const registered = deliveryStructuredOutput.parse(
        registeredResult.structuredContent,
      )
      const listed = normalizeListDeliveriesResult(
        await harness.client.callTool({
          name: 'list_deliveries',
          arguments: { source_ref: sourceRef },
        }),
      )
      const snapshot = await readDeliveryDatabaseSnapshot(tx)
      const actual = {
        registered: {
          ...registeredResult,
          structuredContent: registered,
        },
        listed,
        deliveries: snapshot.deliveries.map(
          ({ id, source_ref, status, expected_date }) => ({
            id,
            source_ref,
            status,
            expected_date,
          }),
        ),
        sourceRefs: snapshot.sourceRefs.map(({ source_ref, delivery_id }) => ({
          source_ref,
          delivery_id,
        })),
        stockLots: snapshot.stockLots.map(
          ({ id, delivery_id, food_master_id, quantity }) => ({
            id,
            delivery_id,
            food_master_id,
            quantity,
          }),
        ),
      }
      const expected = {
        registered: {
          content: [{ type: 'text', text: '入荷予定を保存しました。' }],
          structuredContent: {
            delivery_id: deliveryId,
            source_ref: sourceRef,
            status: 'planned',
            expected_date: '2031-11-01',
            received_date: null,
            change_deadline: null,
            items: [
              {
                food_master_id: foodMasterId,
                food_name: 'Sample newly registered food',
                quantity: 3,
              },
            ],
          },
        },
        listed: {
          content: [{ type: 'text', text: '1 件の配送を取得しました。' }],
          structuredContent: {
            deliveries: [
              {
                delivery_id: deliveryId,
                source_ref: sourceRef,
                source_ref_history: [
                  {
                    source_ref: sourceRef,
                    created_at: NORMALIZED_HISTORY_TIMESTAMP,
                  },
                ],
                status: 'planned',
                expected_date: '2031-11-01',
                received_date: null,
                change_deadline: null,
                items: [
                  {
                    food_master_id: foodMasterId,
                    food_name: 'Sample newly registered food',
                    stock_lot_id: stockLotId,
                    quantity: 3,
                    remaining_quantity: null,
                  },
                ],
              },
            ],
          },
        },
        deliveries: [
          {
            id: deliveryId,
            source_ref: sourceRef,
            status: 'planned',
            expected_date: '2031-11-01',
          },
        ],
        sourceRefs: [{ source_ref: sourceRef, delivery_id: deliveryId }],
        stockLots: [
          {
            id: stockLotId,
            delivery_id: deliveryId,
            food_master_id: foodMasterId,
            quantity: '3',
          },
        ],
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('updates a planned delivery through its prior reference without changing its current reference', async () => {
    const tx = getTx()
    const deliveryId = 'dly_ref_correction_planned'
    const foodMasterId = 'fm_ref_correction_planned'
    const originalSourceRef = 'ref_planned_original'
    const correctedSourceRef = 'ref_planned_corrected'
    await seedFoodMasterWithoutNutritionRow(tx, {
      id: foodMasterId,
      name: 'Sample planned delivery food',
    })
    await seedStockItem(tx, { foodMasterId })
    await seedDelivery(tx, {
      id: deliveryId,
      sourceRef: originalSourceRef,
      status: 'planned',
      expectedDate: '2031-08-01',
    })
    const harness = await startHarness({ tx })

    try {
      await harness.client.callTool({
        name: 'update_delivery_source_ref',
        arguments: {
          delivery_id: deliveryId,
          source_ref: correctedSourceRef,
        },
      })
      const registered = normalizeResult(
        await harness.client.callTool({
          name: 'register_delivery',
          arguments: {
            source_ref: originalSourceRef,
            status: 'planned',
            expected_date: '2031-08-03',
            items: [{ food_master_id: foodMasterId, quantity: 3 }],
          },
        }),
      )
      const state = {
        deliveries: await tx<
          {
            id: string
            source_ref: string | null
            status: string
            expected_date: string
          }[]
        >`
          SELECT id, source_ref, status::text AS status,
                 expected_date::text AS expected_date
          FROM deliveries
          ORDER BY id
        `,
        sourceRefs: await tx<{ source_ref: string; delivery_id: string }[]>`
          SELECT source_ref, delivery_id
          FROM delivery_source_refs
          ORDER BY source_ref
        `,
        stockLots: await tx<
          { delivery_id: string; food_master_id: string; quantity: string }[]
        >`
          SELECT delivery_id, food_master_id, quantity::text AS quantity
          FROM stock_lots
          ORDER BY delivery_id, food_master_id
        `,
      }

      const actual = { registered, state }
      const expected = {
        registered: {
          content: [{ type: 'text', text: '入荷予定を保存しました。' }],
          structuredContent: {
            delivery_id: deliveryId,
            source_ref: correctedSourceRef,
            status: 'planned',
            expected_date: '2031-08-03',
            received_date: null,
            change_deadline: null,
            items: [
              {
                food_master_id: foodMasterId,
                food_name: 'Sample planned delivery food',
                quantity: 3,
              },
            ],
          },
        },
        state: {
          deliveries: [
            {
              id: deliveryId,
              source_ref: correctedSourceRef,
              status: 'planned',
              expected_date: '2031-08-03',
            },
          ],
          sourceRefs: [
            { source_ref: correctedSourceRef, delivery_id: deliveryId },
            { source_ref: originalSourceRef, delivery_id: deliveryId },
          ],
          stockLots: [
            {
              delivery_id: deliveryId,
              food_master_id: foodMasterId,
              quantity: '3',
            },
          ],
        },
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('preserves partial and complete stock records and status output when references change', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const stockStatusBefore = normalizeResult(
        await harness.client.callTool({
          name: 'get_stock_status',
          arguments: {},
        }),
      )
      const partialUpdate = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialNewSourceRef,
          },
        }),
      )
      const completeUpdate = normalizeUpdateDeliverySourceRefResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.completeDeliveryId,
            source_ref: scenario.completeNewSourceRef,
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)
      const stockStatusAfter = normalizeResult(
        await harness.client.callTool({
          name: 'get_stock_status',
          arguments: {},
        }),
      )
      const expectedStockStatus = {
        content: [
          {
            type: 'text',
            text: '1 件の在庫状況と 0 件の入荷予定を取得しました。',
          },
        ],
        structuredContent: {
          stock_items: [
            {
              food_master_id: scenario.foodMasterId,
              food_name: 'Sample delivery food',
              total_quantity: 3,
              storage_location: null,
              eat_within_days: null,
              lots: [
                {
                  stock_lot_id: 'stl_ref_correction_partial',
                  quantity: 5,
                  remaining_quantity: 3,
                  received_date: '2031-07-02',
                  best_before: null,
                  eat_by: null,
                },
              ],
            },
          ],
          planned_deliveries: [],
          capacity_warnings: [],
          eat_by_warnings: [],
          priority_lots: [
            {
              food_master_id: scenario.foodMasterId,
              food_name: 'Sample delivery food',
              stock_lot_id: 'stl_ref_correction_partial',
              remaining_quantity: 3,
              target_date: null,
              reasons: ['oldest_received'],
            },
          ],
        },
      }

      const actual = {
        updates: [partialUpdate, completeUpdate],
        inventoryAfter: inventorySnapshot(after),
        stockStatusBefore,
        stockStatusAfter,
      }
      const expected = {
        updates: [
          {
            content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
            structuredContent: {
              delivery_id: scenario.partialDeliveryId,
              source_ref: scenario.partialNewSourceRef,
              source_ref_history: [
                {
                  source_ref: scenario.partialOldSourceRef,
                  created_at: NORMALIZED_HISTORY_TIMESTAMP,
                },
                {
                  source_ref: scenario.partialNewSourceRef,
                  created_at: NORMALIZED_HISTORY_TIMESTAMP,
                },
              ],
              status: 'received',
              expected_date: '2031-07-01',
              received_date: '2031-07-02',
              change_deadline: null,
              items: [
                {
                  food_master_id: scenario.foodMasterId,
                  food_name: 'Sample delivery food',
                  stock_lot_id: 'stl_ref_correction_partial',
                  quantity: 5,
                  remaining_quantity: 3,
                },
              ],
            },
          },
          {
            content: [{ type: 'text', text: '配送の参照を訂正しました。' }],
            structuredContent: {
              delivery_id: scenario.completeDeliveryId,
              source_ref: scenario.completeNewSourceRef,
              source_ref_history: [
                {
                  source_ref: scenario.completeOldSourceRef,
                  created_at: NORMALIZED_HISTORY_TIMESTAMP,
                },
                {
                  source_ref: scenario.completeNewSourceRef,
                  created_at: NORMALIZED_HISTORY_TIMESTAMP,
                },
              ],
              status: 'received',
              expected_date: '2031-07-03',
              received_date: '2031-07-04',
              change_deadline: null,
              items: [
                {
                  food_master_id: scenario.foodMasterId,
                  food_name: 'Sample delivery food',
                  stock_lot_id: 'stl_ref_correction_complete',
                  quantity: 4,
                  remaining_quantity: 0,
                },
              ],
            },
          },
        ],
        inventoryAfter: inventorySnapshot(before),
        stockStatusBefore: expectedStockStatus,
        stockStatusAfter: expectedStockStatus,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('rejects reusing a reference from the same delivery history', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      await harness.client.callTool({
        name: 'update_delivery_source_ref',
        arguments: {
          delivery_id: scenario.partialDeliveryId,
          source_ref: scenario.partialNewSourceRef,
        },
      })
      const before = await readDeliveryDatabaseSnapshot(tx)
      const conflict = normalizeResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.partialOldSourceRef,
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)

      const actual = { conflict, before, after }
      const expected = {
        conflict: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `source_ref is already used by delivery ${scenario.partialDeliveryId}`,
            },
          ],
        },
        before,
        after: before,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('leaves all delivery rows unchanged when a reference belongs to another delivery', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const conflict = normalizeResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: scenario.completeOldSourceRef,
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)

      const actual = { conflict, before, after }
      const expected = {
        conflict: {
          isError: true,
          content: [
            {
              type: 'text',
              text: `source_ref is already used by delivery ${scenario.completeDeliveryId}`,
            },
          ],
        },
        before,
        after: before,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('leaves all delivery rows unchanged when the delivery id does not exist', async () => {
    const tx = getTx()
    await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const missing = normalizeResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: 'dly_missing_source_ref',
            source_ref: 'ref_unused_source',
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)

      const actual = { missing, before, after }
      const expected = {
        missing: {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'delivery not found: dly_missing_source_ref',
            },
          ],
        },
        before,
        after: before,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })

  it('leaves all delivery rows unchanged for invalid reference input', async () => {
    const tx = getTx()
    const scenario = await seedDeliverySourceRefCorrectionScenario(tx)
    const harness = await startHarness({ tx })

    try {
      const before = await readDeliveryDatabaseSnapshot(tx)
      const invalid = normalizeValidationErrorResult(
        await harness.client.callTool({
          name: 'update_delivery_source_ref',
          arguments: {
            delivery_id: scenario.partialDeliveryId,
            source_ref: '   ',
          },
        }),
      )
      const after = await readDeliveryDatabaseSnapshot(tx)

      const actual = { invalid, before, after }
      const expected = {
        invalid: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        before,
        after: before,
      }
      expect(observation(actual)).toEqual(expected)
    } finally {
      await harness.close()
    }
  })
})
