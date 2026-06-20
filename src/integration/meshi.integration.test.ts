import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { beforeEach, expect, it } from 'vitest'
import { z } from 'zod'

import { createDrizzleUserProfileRepository } from '@/adapters/db/drizzle-user-profile-repository'
import type { LlmClient, LlmRunInput, LlmRunOutput } from '@/adapters/llm/types'
import type {
  WebSearchClient,
  WebSearchResult,
} from '@/adapters/web-search/web-search-client'
import type { Sql } from '@/db'
import { upsertNutrientDefinitions } from '@/db/seed/nutrient-definitions'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '@/domain/food-master'
import { createDrizzleFoodMatcher } from '@/domain/food-matcher'
import { createMealHistoryService } from '@/domain/meal-history'
import { createDrizzleMealLogRepository } from '@/domain/meal-log/drizzle-meal-log-repository'
import { createMealLogService } from '@/domain/meal-log/meal-log-service'
import { createUserProfileService } from '@/domain/user-profile/user-profile-service'
import { createDomainToolsRegistry } from '@/llm/domain-tools'
import {
  createConversationOrchestrator,
  createTemplateReplyFormatter,
} from '@/llm/orchestrator'
import { createNullLogger } from '@/logger'
import { createMcpServer } from '@/mcp'
import { describeIfDb, getTestSql, setupTx } from '@/test/db'

// scripted LLM ------------------------------------------------------------

interface ScriptedToolCall {
  readonly name: string
  readonly input: unknown
}

interface ScriptedRun {
  readonly toolCalls?: ReadonlyArray<ScriptedToolCall>
  readonly finalText?: string
}

const scriptedLlmClient = (
  scripts: ReadonlyArray<ScriptedRun>,
): { client: LlmClient; remaining: () => number } => {
  let index = 0
  const client: LlmClient = {
    async runConversation(input: LlmRunInput): Promise<LlmRunOutput> {
      const script = scripts[index]
      if (script === undefined) {
        throw new Error(
          `scripted LLM ran out of scripts on call #${String(index + 1)}`,
        )
      }
      index += 1
      let turns = 0
      for (const call of script.toolCalls ?? []) {
        turns += 1
        await input.executeTool({
          id: `tu_${String(index)}_${String(turns)}`,
          name: call.name,
          input: call.input,
        })
      }
      return {
        finalText: script.finalText ?? '',
        messages: [...input.messages],
        stopReason: 'end',
        turns,
      }
    },
  }
  return { client, remaining: () => scripts.length - index }
}

const stubWebSearchClient = (result: WebSearchResult): WebSearchClient => ({
  search: () => Promise.resolve(result),
})

// harness -----------------------------------------------------------------

interface Harness {
  readonly client: Client
  readonly scriptsRemaining: () => number
  readonly close: () => Promise<void>
}

interface HarnessOptions {
  readonly tx: Sql
  readonly scripts: ReadonlyArray<ScriptedRun>
  readonly webSearch?: WebSearchResult
  readonly mealLogIds?: ReadonlyArray<string>
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

const DEFAULT_WEB_SEARCH: WebSearchResult = {
  snippets: [
    {
      title: 'placeholder',
      url: 'https://example.com',
      text: 'placeholder snippet',
    },
  ],
}

const startHarness = async (opts: HarnessOptions): Promise<Harness> => {
  const tx = prepareTxForDrizzle(opts.tx)
  const timestampSnapshot = snapshotTimestampHandlers(tx)

  const mealLogRepository = createDrizzleMealLogRepository(tx)
  const mealLogIds = opts.mealLogIds ?? []
  let mealLogIdCursor = 0
  const idGenerator = (): string => {
    const id = mealLogIds[mealLogIdCursor]
    mealLogIdCursor += 1
    return id ?? `ml_test_${String(mealLogIdCursor).padStart(4, '0')}`
  }
  const mealLogService = createMealLogService({
    repository: mealLogRepository,
    idGenerator,
    // pin to a fixed point in time so eaten_at validation is deterministic
    now: () => new Date('2026-06-12T22:00:00+09:00'),
  })

  let foodMasterIdCursor = 0
  const foodMasterIdGen = (prefix: string): string => {
    foodMasterIdCursor += 1
    return `${prefix}_test_${String(foodMasterIdCursor).padStart(4, '0')}`
  }
  const foodMasterRepository = createFoodMasterRepository(tx, {
    generateId: foodMasterIdGen,
    // The outer per-test transaction already provides atomicity; postgres-js
    // rejects a nested BEGIN inside it.
    wrapInTransaction: false,
  })
  const foodMasterService = createFoodMasterService(foodMasterRepository)
  const foodMatcher = createDrizzleFoodMatcher(tx)
  const mealHistoryService = createMealHistoryService(tx)
  const userProfileService = createUserProfileService(
    createDrizzleUserProfileRepository(tx),
  )
  // Production code uses raw `tx\`... ${date}\`` binds and z.date() on
  // results; drizzle's constructor flips the timestamp handlers to identity,
  // so restore them.
  restoreTimestampHandlers(tx, timestampSnapshot)
  const webSearchClient = stubWebSearchClient(
    opts.webSearch ?? DEFAULT_WEB_SEARCH,
  )

  const { client: llmClient, remaining } = scriptedLlmClient(opts.scripts)

  const registry = createDomainToolsRegistry({
    mealLogService,
    foodMasterService,
    foodMatcher,
    mealHistoryService,
    userProfileService,
    webSearchClient,
  })
  const orchestrator = createConversationOrchestrator({
    llmClient,
    registry,
    textModel: 'test-text-model',
    visionModel: 'test-vision-model',
    maxTurns: 10,
    formatter: createTemplateReplyFormatter(),
  })

  const server = createMcpServer({
    orchestrator,
    profileService: userProfileService,
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
    scriptsRemaining: remaining,
    async close() {
      await client.close()
      await server.close()
      // Surface unused scripts so silent under-use of the scripted LLM
      // (e.g. the orchestrator stopped earlier than the test expected)
      // shows up as a test failure rather than dead test data.
      if (remaining() !== 0) {
        throw new Error(
          `scripted LLM left ${String(remaining())} run(s) unused`,
        )
      }
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
    INSERT INTO food_masters (id, name, is_estimated, source)
    VALUES (${args.id}, ${args.name}, ${args.isEstimated ?? false}, 'user_input')
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
    readonly eatenAt: string
    readonly quantity: number
    readonly unit: string
  },
): Promise<void> => {
  await tx`
    INSERT INTO meal_logs (id, food_master_id, eaten_at, quantity, unit)
    VALUES (
      ${args.id},
      ${args.foodMasterId},
      ${new Date(args.eatenAt)},
      ${String(args.quantity)},
      ${args.unit}
    )
  `
}

const candidateResultSchema = z.object({
  recorded: z.array(z.unknown()),
  candidates: z.array(
    z.object({
      food_master_id: z.string().nullable(),
      composition_code: z.string().nullable(),
      name: z.string(),
      is_estimated: z.boolean(),
      reason: z.string(),
      score: z.number(),
    }),
  ),
  has_estimated_values: z.boolean(),
  error: z.null(),
})

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

const textContent = (result: NormalizedToolResult): ReadonlyArray<string> =>
  result.content
    .filter(
      (c): c is { readonly type: 'text'; readonly text: string } =>
        c.type === 'text' && typeof c.text === 'string',
    )
    .map((c) => c.text)

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

  it('records a meal from text — search + record_meal_log writes the log', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      nutrition: { energy_kcal: 168, protein_g: 2.5, carbohydrate_g: 37 },
    })

    const harness = await startHarness({
      tx,
      mealLogIds: ['ml_scenario1'],
      scripts: [
        {
          toolCalls: [
            { name: 'search_food_master', input: { query: '白米' } },
            {
              name: 'record_meal_log',
              input: {
                food_master_id: 'fm_rice',
                eaten_at_iso: '2026-06-12T12:30:00+09:00',
                quantity: 200,
                unit: 'g',
              },
            },
          ],
          finalText: '白米 200g を記録しました。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'record_meal_from_text',
          arguments: { text: '昼に白米 200g を食べました' },
        }),
      )

      expect({
        isError: result.isError ?? false,
        content: textContent(result),
        structuredContent: result.structuredContent,
      }).toEqual({
        isError: false,
        content: [
          ['記録しました (1 件)。', '- fm_rice: 336 kcal / P 5g / C 74g'].join(
            '\n',
          ),
        ],
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'ml_scenario1',
              food_master_id: 'fm_rice',
              nutrition: { energy_kcal: 336, protein_g: 5, carbohydrate_g: 74 },
              is_estimated: false,
            },
          ],
          candidates: [],
          has_estimated_values: false,
          error: null,
        },
      })

      const rows = await tx<
        { id: string; food_master_id: string; quantity: string; unit: string }[]
      >`
        SELECT id, food_master_id, quantity, unit FROM meal_logs
      `
      expect(rows).toEqual([
        {
          id: 'ml_scenario1',
          food_master_id: 'fm_rice',
          quantity: '200',
          unit: 'g',
        },
      ])
    } finally {
      await harness.close()
    }
  })

  it('on-demand registration — search → web_search → register → record', async () => {
    const tx = getTx()

    const harness = await startHarness({
      tx,
      mealLogIds: ['ml_scenario2'],
      webSearch: {
        snippets: [
          {
            title: 'matcha latte nutrition',
            url: 'https://example.com/matcha',
            text: 'matcha latte ~120 kcal per serving',
          },
        ],
      },
      scripts: [
        {
          toolCalls: [
            {
              name: 'search_food_master',
              input: { query: 'スターバックス抹茶ラテ' },
            },
            {
              name: 'web_search',
              input: { query: 'スターバックス 抹茶ラテ 栄養成分' },
            },
            {
              name: 'register_food_master',
              input: {
                name: 'スターバックス抹茶ラテ',
                nutrition_per_100g: { energy_kcal: 60, protein_g: 2 },
                source: 'web_search',
                is_estimated: false,
                source_url: 'https://example.com/matcha',
              },
            },
            {
              name: 'record_meal_log',
              input: {
                food_master_id: 'fm_test_0001',
                eaten_at_iso: '2026-06-12T15:00:00+09:00',
                quantity: 350,
                unit: 'g',
              },
            },
          ],
          finalText: '抹茶ラテを記録しました。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'record_meal_from_text',
          arguments: {
            text: 'スターバックスの抹茶ラテ Tall (350g) を飲みました',
          },
        }),
      )

      expect({
        isError: result.isError ?? false,
        structuredContent: result.structuredContent,
      }).toEqual({
        isError: false,
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'ml_scenario2',
              food_master_id: 'fm_test_0001',
              nutrition: { energy_kcal: 210, protein_g: 7 },
              is_estimated: false,
            },
          ],
          candidates: [],
          has_estimated_values: false,
          error: null,
        },
      })
      expect(textContent(result)).toEqual([
        ['記録しました (1 件)。', '- fm_test_0001: 210 kcal / P 7g'].join('\n'),
      ])

      const masters = await tx<{ id: string; name: string; source: string }[]>`
        SELECT id, name, source FROM food_masters ORDER BY id
      `
      expect(masters).toEqual([
        {
          id: 'fm_test_0001',
          name: 'スターバックス抹茶ラテ',
          source: 'web_search',
        },
      ])
      const mealLogCount = await tx<
        { count: string }[]
      >`SELECT COUNT(*)::text AS count FROM meal_logs`
      expect(mealLogCount).toEqual([{ count: '1' }])
    } finally {
      await harness.close()
    }
  })

  it('candidates without confirmation — recorded empty, candidates returned', async () => {
    const tx = getTx()
    // Two ambiguous candidates: matcher finds both via trigram on '茶'.
    await seedFoodMaster(tx, {
      id: 'fm_salmon_teriyaki',
      name: 'salmon teriyaki',
      nutrition: { energy_kcal: 200 },
    })
    await seedFoodMaster(tx, {
      id: 'fm_salmon_sushi',
      name: 'salmon sushi',
      nutrition: { energy_kcal: 150 },
    })

    const harness = await startHarness({
      tx,
      scripts: [
        {
          toolCalls: [
            { name: 'search_food_master', input: { query: 'salmon' } },
          ],
          finalText: 'どの salmon メニューか特定できませんでした。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'record_meal_from_text',
          arguments: { text: 'salmon を食べた' },
        }),
      )

      const structured = candidateResultSchema.parse(result.structuredContent)
      // The trigram score is non-deterministic, so collapse it into rank order
      // while keeping every other field literal.
      const normalizedCandidates = [...structured.candidates]
        .sort((a, b) =>
          (a.food_master_id ?? '') < (b.food_master_id ?? '') ? -1 : 1,
        )
        .map((c) => ({
          food_master_id: c.food_master_id,
          composition_code: c.composition_code,
          name: c.name,
          is_estimated: c.is_estimated,
          reason: c.reason,
        }))
      const candidateNames = normalizedCandidates.map((c) => c.name).sort()

      expect({
        isError: result.isError ?? false,
        recorded: structured.recorded,
        has_estimated_values: structured.has_estimated_values,
        error: structured.error,
        candidates: normalizedCandidates,
        content: textContent(result).map((line) => {
          // matcher orders by trigram score, which is non-deterministic
          // between the two equally-similar names — sort the rendered list.
          const lines = line.split('\n')
          const [header, ...rest] = lines
          if (header === undefined) return line
          return [header, ...[...rest].sort()].join('\n')
        }),
      }).toEqual({
        isError: false,
        recorded: [],
        has_estimated_values: false,
        error: null,
        candidates: [
          {
            food_master_id: 'fm_salmon_sushi',
            composition_code: null,
            name: 'salmon sushi',
            is_estimated: false,
            reason: 'fuzzy_name',
          },
          {
            food_master_id: 'fm_salmon_teriyaki',
            composition_code: null,
            name: 'salmon teriyaki',
            is_estimated: false,
            reason: 'fuzzy_name',
          },
        ],
        content: [
          [
            '食品を一意に特定できませんでした。次の候補から選んで、もう一度入力してください。',
            ...candidateNames.map((n) => `- ${n}: fuzzy_name`),
          ].join('\n'),
        ],
      })

      const rows = await tx<
        { count: string }[]
      >`SELECT COUNT(*)::text AS count FROM meal_logs`
      expect(rows).toEqual([{ count: '0' }])
    } finally {
      await harness.close()
    }
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
      eatenAt: '2026-06-12T03:30:00+00:00',
      quantity: 200,
      unit: 'g',
    })

    const harness = await startHarness({
      tx,
      scripts: [
        {
          toolCalls: [
            {
              name: 'query_meal_history',
              input: {
                period_from_iso: '2026-06-12T00:00:00+00:00',
                period_to_iso: '2026-06-13T00:00:00+00:00',
              },
            },
          ],
          finalText: '2026-06-12 の合計を返しました。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'query_meals',
          arguments: {
            query_text: '2026-06-12 の合計を教えて',
            period_from_iso: '2026-06-12T00:00:00+00:00',
            period_to_iso: '2026-06-13T00:00:00+00:00',
          },
        }),
      )

      expect({
        isError: result.isError ?? false,
        structuredContent: result.structuredContent,
        content: textContent(result),
      }).toEqual({
        isError: false,
        structuredContent: {
          aggregate: {
            totals: { energy_kcal: 336, protein_g: 5, carbohydrate_g: 74 },
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
                eaten_at_iso: '2026-06-12T03:30:00.000Z',
                quantity: 200,
                unit: 'g',
                note: null,
              },
            ],
            has_estimated_values: false,
          },
          has_estimated_values: false,
          error: null,
        },
        content: [
          [
            '集計結果:',
            '- 合計: 336 kcal / P 5g / C 74g',
            '- 期間内の日数: 1 日',
            '- 記録件数: 1 件',
          ].join('\n'),
        ],
      })
    } finally {
      await harness.close()
    }
  })

  it('recommends a meal based on profile + recent history', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      nutrition: { energy_kcal: 168 },
    })

    const harness = await startHarness({
      tx,
      scripts: [
        {
          toolCalls: [
            { name: 'get_user_profile', input: {} },
            {
              name: 'query_meal_history',
              input: {
                period_from_iso: '2026-06-11T00:00:00+00:00',
                period_to_iso: '2026-06-13T00:00:00+00:00',
              },
            },
          ],
          finalText: 'サバ味噌煮定食はいかがでしょう。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'recommend_meal',
          arguments: { additional_constraints: '軽め' },
        }),
      )

      expect({
        isError: result.isError ?? false,
        structuredContent: result.structuredContent,
        content: textContent(result),
      }).toEqual({
        isError: false,
        structuredContent: { error: null },
        content: ['サバ味噌煮定食はいかがでしょう。'],
      })
    } finally {
      await harness.close()
    }
  })

  it('records a meal from an image (vision agent)', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      nutrition: { energy_kcal: 168, protein_g: 2.5, carbohydrate_g: 37 },
    })

    // 1x1 transparent PNG
    const TINY_PNG_BASE64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgAAIAAAUAAeImBZsAAAAASUVORK5CYII='

    const harness = await startHarness({
      tx,
      mealLogIds: ['ml_image_1'],
      scripts: [
        {
          toolCalls: [
            { name: 'search_food_master', input: { query: '白米' } },
            {
              name: 'record_meal_log',
              input: {
                food_master_id: 'fm_rice',
                eaten_at_iso: '2026-06-12T19:30:00+09:00',
                quantity: 150,
                unit: 'g',
              },
            },
          ],
          finalText: '写真から白米 150g を記録しました。',
        },
      ],
    })

    try {
      const result = normalizeResult(
        await harness.client.callTool({
          name: 'record_meal_from_image',
          arguments: {
            image: {
              type: 'image',
              mimeType: 'image/png',
              data: TINY_PNG_BASE64,
            },
            hint_text: '夕食',
          },
        }),
      )

      expect({
        isError: result.isError ?? false,
        structuredContent: result.structuredContent,
        content: textContent(result),
      }).toEqual({
        isError: false,
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'ml_image_1',
              food_master_id: 'fm_rice',
              nutrition: {
                energy_kcal: 252,
                protein_g: 3.75,
                carbohydrate_g: 55.5,
              },
              is_estimated: false,
            },
          ],
          candidates: [],
          has_estimated_values: false,
          error: null,
        },
        content: [
          [
            '記録しました (1 件)。',
            '- fm_rice: 252 kcal / P 3.8g / C 55.5g',
          ].join('\n'),
        ],
      })

      const logs = await tx<
        { id: string; quantity: string }[]
      >`SELECT id, quantity FROM meal_logs`
      expect(logs).toEqual([{ id: 'ml_image_1', quantity: '150' }])
    } finally {
      await harness.close()
    }
  })

  it('profile CRUD — update_profile then get_profile reflects the patch', async () => {
    const tx = getTx()
    const harness = await startHarness({
      tx,
      scripts: [],
    })

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

      expect({
        isError: updated.isError ?? false,
        content: textContent(updated),
        structuredContent: updated.structuredContent,
      }).toEqual({
        isError: false,
        content: ['プロファイルを更新しました。'],
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

      expect({
        isError: fetched.isError ?? false,
        content: textContent(fetched),
        structuredContent: fetched.structuredContent,
      }).toEqual({
        isError: false,
        content: ['プロファイルを取得しました。'],
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
