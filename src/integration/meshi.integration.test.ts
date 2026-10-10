import { randomUUID } from 'node:crypto'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { beforeEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createDrizzleUserProfileRepository } from '#adapters/db/drizzle-user-profile-repository'
import type { Sql } from '#db/index'
import { upsertNutrientDefinitions } from '#db/seed/nutrient-definitions'
import { createFoodSearchService } from '#domain/food-browse/index'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '#domain/food-master/index'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { createMealHistoryService } from '#domain/meal-history/index'
import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type { MealType } from '#domain/meal-log/types'
import { createDrizzleMealSkipRepository } from '#domain/meal-skip/drizzle-meal-skip-repository'
import { createMealSkipService } from '#domain/meal-skip/meal-skip-service'
import { createUserProfileService } from '#domain/user-profile/user-profile-service'
import { createMcpServer } from '#mcp'
import { describeIfDb, getTestSql, setupTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { createNullLogger } from '#test/logger'
import {
  seedFoodMaster as seedFoodMasterRow,
  seedMealLog as seedMealLogRow,
} from '#test/seed'

const observation = <T extends object>(value: T): T => value

// harness -----------------------------------------------------------------

interface Harness {
  readonly client: Client
  readonly close: () => Promise<void>
}

interface HarnessOptions {
  readonly tx: Sql
}

const readOptions = (sql: Sql): unknown => Reflect.get(sql, 'options')

// Borrow the pool's options onto ReservedSql so drizzle can mutate the
// jsonb/timestamp serializers it needs at construction time.
const prepareTxForDrizzle = (tx: Sql): Sql => {
  if (readOptions(tx) !== undefined) return tx
  Object.defineProperty(tx, 'options', {
    value: readOptions(getTestSql()),
    configurable: true,
    writable: true,
  })
  return tx
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
          per_day: [
            {
              date: '2026-06-12',
              totals: {
                energy_kcal: 336,
                protein_g: 5,
                carbohydrate_g: 74,
              },
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
            },
          ],
          has_estimated_values: false,
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
            per_day: [
              {
                date: '2026-04-17',
                totals: { energy_kcal: 411, protein_g: 15 },
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
              },
            ],
            has_estimated_values: false,
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
})
