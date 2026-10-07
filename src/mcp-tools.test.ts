import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import {
  type MealHistoryAggregate,
  MealHistoryQueryError,
  type MealHistoryService,
} from '#domain/meal-history/types'
import {
  DomainError,
  InvalidQuantityError,
  MealLogItemValidationError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type {
  RecordMealLogItemResult,
  RecordMealLogsInput,
} from '#domain/meal-log/types'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type {
  UserProfile,
  UserProfilePatch,
} from '#domain/user-profile/user-profile'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
import type {
  ConversationOrchestrator,
  MealRecordResult,
  OrchestratorError,
} from '#llm/orchestrator/index'
import type {
  RecordFromImageInput,
  RecordFromTextInput,
} from '#llm/orchestrator/types'
import type { Logger } from '#logger'
import { createMcpServer } from '#mcp'
import { jstDate } from '#test/jst-date'

const VALIDATION_ERROR_TEXT = '<schema validation error>'

// zod's exact error message (JSON shape, field ordering, "code" names) is an
// implementation detail of the MCP SDK / zod version, not part of this app's
// contract — normalize it to a fixed placeholder so these tests don't break
// on a zod/SDK upgrade unrelated to app behavior.
const normalizeValidationError = <
  T extends { content?: { type: string }[]; [key: string]: unknown },
>(
  result: T,
): T => {
  if (!result.content) return result
  return {
    ...result,
    content: result.content.map((c) =>
      c.type === 'text' ? { ...c, text: VALIDATION_ERROR_TEXT } : c,
    ),
  }
}

const observation = <T extends object>(value: T): T => value

interface LogEntry {
  readonly event: string
  readonly payload: Readonly<Record<string, unknown>>
}

const makeLogger = (sink: LogEntry[]): Logger => ({
  log(event, payload) {
    sink.push({ event, payload: payload ?? {} })
  },
})

const successMealRecord: MealRecordResult = {
  recorded: [
    {
      mealLogId: 'log-1',
      foodMasterId: 'food-1',
      nutrition: { energy_kcal: 312 },
      isEstimated: false,
    },
  ],
  candidates: [],
  hasEstimatedValues: false,
  summaryText: '白米 200g を記録しました。',
  error: null,
}

const candidateMealRecord: MealRecordResult = {
  recorded: [],
  candidates: [
    {
      foodMasterId: 'food-9',
      compositionCode: null,
      name: '白米',
      isEstimated: false,
      score: 0.5,
      reason: 'history_recent',
    },
  ],
  hasEstimatedValues: false,
  summaryText: '食品を一意に特定できませんでした。',
  error: null,
}

const erroredMealRecord: MealRecordResult = {
  recorded: [],
  candidates: [],
  hasEstimatedValues: false,
  summaryText: '処理が長くなったため中断しました。',
  error: {
    kind: 'max_turns_exceeded',
    message: 'max turns',
  } satisfies OrchestratorError,
}

const successMealHistory: MealHistoryAggregate = {
  totals: { energy_kcal: 1850 },
  perDay: [{ date: jstDate('2026-06-12'), totals: { energy_kcal: 1850 } }],
  entries: [
    {
      id: 'log-1',
      foodMasterId: 'food-1',
      foodName: '白米',
      eatenDate: jstDate('2026-06-12'),
      mealType: 'lunch',
      quantity: 1,
      recordedAt: '2026-06-12T03:30:45Z',
    },
  ],
  hasEstimatedValues: false,
}

const searchFoodResults = [
  {
    foodMasterId: 'fm_catalog_alpha',
    name: 'item_token_alpha',
    isEstimated: false,
    energyKcalPerUnit: 42,
  },
]

const recordedMealLogItems: ReadonlyArray<RecordMealLogItemResult> = [
  {
    id: 'ml_tool_alpha',
    foodMasterId: 'fm_catalog_alpha',
    foodName: 'item_token_alpha',
    eatenDate: jstDate('2026-06-12'),
    mealType: 'lunch',
    quantity: 2,
    createdAt: new Date('2026-06-12T03:00:00.000Z'),
    nutrition: { energy_kcal: 84, protein_g: 3 },
    isEstimated: false,
  },
]

interface OrchestratorCalls {
  recordFromText: RecordFromTextInput[]
  recordFromImage: RecordFromImageInput[]
}

interface OrchestratorOverrides {
  recordFromText?: MealRecordResult | Error
  recordFromImage?: MealRecordResult | Error
}

const makeOrchestrator = (
  overrides: OrchestratorOverrides = {},
): { orchestrator: ConversationOrchestrator; calls: OrchestratorCalls } => {
  const calls: OrchestratorCalls = {
    recordFromText: [],
    recordFromImage: [],
  }
  const resolve = <T>(value: T | Error): Promise<T> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value)
  const orchestrator: ConversationOrchestrator = {
    recordFromText(input) {
      calls.recordFromText.push(input)
      return resolve(overrides.recordFromText ?? successMealRecord)
    },
    recordFromImage(input) {
      calls.recordFromImage.push(input)
      return resolve(overrides.recordFromImage ?? successMealRecord)
    },
  }
  return { orchestrator, calls }
}

interface MealHistoryCalls {
  query: { periodFrom: string; periodTo: string }[]
}

const makeMealHistoryService = (
  overrides: {
    query?: MealHistoryAggregate | MealHistoryQueryError | (() => never)
  } = {},
): { service: MealHistoryService; calls: MealHistoryCalls } => {
  const calls: MealHistoryCalls = { query: [] }
  const service: MealHistoryService = {
    query(input) {
      calls.query.push(input)
      const result = overrides.query ?? successMealHistory
      if (typeof result === 'function') return result()
      return result instanceof MealHistoryQueryError
        ? errAsync(result)
        : okAsync(result)
    },
  }
  return { service, calls }
}

const defaultProfile: UserProfile = {
  likes: ['rice'],
  dislikes: [],
  allergies: [],
  constraints: [],
}

const recommendationProfile: UserProfile = {
  likes: ['profile_favorite_alpha'],
  dislikes: ['profile_avoid_beta'],
  allergies: ['allergen_gamma'],
  constraints: ['diet_constraint_delta'],
  dailyTargets: { energy_kcal: 2222, protein_g: 111 },
}

const recommendationHistory: MealHistoryAggregate = {
  totals: { energy_kcal: 701, protein_g: 27 },
  perDay: [
    {
      date: jstDate('2025-11-23'),
      totals: { energy_kcal: 701, protein_g: 27 },
    },
  ],
  entries: [
    {
      id: 'meal_log_delta',
      foodMasterId: 'food_master_delta',
      foodName: 'sample_meal_delta',
      eatenDate: jstDate('2025-11-23'),
      mealType: 'breakfast',
      quantity: 1.25,
      recordedAt: '2025-11-23T04:05:06Z',
    },
  ],
  hasEstimatedValues: true,
}

const recommendationPeriod = {
  period_from: '2025-11-20',
  period_to: '2025-11-27',
}

interface ProfileCalls {
  get: number
  update: UserProfilePatch[]
}

interface DirectMealToolCalls {
  foodSearch: Array<{ queries: ReadonlyArray<string>; limit: number }>
  recordMealLogs: RecordMealLogsInput[]
}

const makeProfileService = (
  initial: UserProfile = defaultProfile,
  overrides: {
    get?: UserProfileRepositoryError
    update?: UserProfileRepositoryError
  } = {},
): { service: UserProfileService; calls: ProfileCalls } => {
  let current = initial
  const calls: ProfileCalls = { get: 0, update: [] }
  const service: UserProfileService = {
    get() {
      calls.get++
      if (overrides.get) return errAsync(overrides.get)
      return okAsync(current)
    },
    update(patch) {
      calls.update.push(patch)
      if (overrides.update) return errAsync(overrides.update)
      const { dailyTargets, ...rest } = patch
      // exhaustively cover the three cases — clear / set / keep — so the
      // resulting object never carries a stray null in dailyTargets.
      const base = { ...current, ...rest }
      if (dailyTargets === null) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars -- destructure to drop the field from the rest spread.
        const { dailyTargets: _drop, ...cleared } = base
        current = cleared
      } else if (dailyTargets !== undefined) {
        current = { ...base, dailyTargets }
      } else {
        current = base
      }
      return okAsync(current)
    },
  }
  return { service, calls }
}

interface Harness {
  client: Client
  logs: LogEntry[]
  calls: OrchestratorCalls
  mealHistoryCalls: MealHistoryCalls
  profileCalls: ProfileCalls
  directMealToolCalls: DirectMealToolCalls
  close: () => Promise<void>
}

interface HarnessConfig {
  orchestratorOverrides?: OrchestratorOverrides
  mealHistoryOverrides?: {
    query?: MealHistoryAggregate | MealHistoryQueryError | (() => never)
  }
  profileOverrides?: {
    get?: UserProfileRepositoryError
    update?: UserProfileRepositoryError
  }
  profile?: UserProfile
  foodSearchServiceResult?: ReturnType<FoodSearchService['searchRegistered']>
  recordMealLogError?: DomainError
}

const start = async (config: HarnessConfig = {}): Promise<Harness> => {
  const logs: LogEntry[] = []
  const logger = makeLogger(logs)
  const { orchestrator, calls } = makeOrchestrator(
    config.orchestratorOverrides ?? {},
  )
  const { service: mealHistoryService, calls: mealHistoryCalls } =
    makeMealHistoryService(config.mealHistoryOverrides ?? {})
  const { service: profileService, calls: profileCalls } = makeProfileService(
    config.profile ?? defaultProfile,
    config.profileOverrides ?? {},
  )
  const directMealToolCalls: DirectMealToolCalls = {
    foodSearch: [],
    recordMealLogs: [],
  }
  const foodSearchService: FoodSearchService = {
    searchRegistered(queries, limit) {
      directMealToolCalls.foodSearch.push({ queries, limit })
      return config.foodSearchServiceResult ?? okAsync(searchFoodResults)
    },
  }
  const mealLogService: MealLogService = {
    record: () => errAsync(new DomainError('unused', 'test/unused')),
    recordMany(input) {
      directMealToolCalls.recordMealLogs.push(input)
      return config.recordMealLogError === undefined
        ? okAsync(recordedMealLogItems)
        : errAsync(config.recordMealLogError)
    },
    update: () => errAsync(new DomainError('unused', 'test/unused')),
    getById: () => errAsync(new DomainError('unused', 'test/unused')),
    delete: () => errAsync(new DomainError('unused', 'test/unused')),
  }
  const server = createMcpServer({
    orchestrator,
    mealHistoryService,
    profileService,
    foodSearchService,
    mealLogService,
    logger,
  })
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'meshi-test', version: '0.0.0' })
  await client.connect(clientTransport)
  return {
    client,
    logs,
    calls,
    mealHistoryCalls,
    profileCalls,
    directMealToolCalls,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

describe('MeshiMcpServer tools/list', () => {
  it('exposes the eight public tools with stable names', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const names = result.tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'get_profile',
        'get_recommendation_context',
        'query_meals',
        'record_meal_from_image',
        'record_meal_from_text',
        'record_meal_log',
        'search_foods',
        'update_profile',
      ])
    } finally {
      await h.close()
    }
  })

  it('explains that the caller interprets results and can identify records by meal_log_id', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const queryMeals = result.tools.find(
        (tool) => tool.name === 'query_meals',
      )
      expect(queryMeals?.description).toEqual(
        'JST の period_from 以上、period_to 未満の食事履歴と栄養集計を返す。質問の解釈と集計結果の説明は ChatGPT が行う。後で記録を削除・修正するときは各記録の meal_log_id を使う。',
      )
    } finally {
      await h.close()
    }
  })

  it('pins each tool input schema to a domain-only property set (no chat-platform fields)', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const propsByTool: Record<string, string[]> = {}
      for (const tool of result.tools) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- the SDK reports inputSchema as a generic record; we read top-level keys only.
        const schema = tool.inputSchema as {
          properties?: Record<string, unknown>
        }
        propsByTool[tool.name] = Object.keys(schema.properties ?? {}).sort()
      }
      expect(propsByTool).toEqual({
        get_profile: [],
        get_recommendation_context: ['period_from', 'period_to'],
        record_meal_log: ['date', 'items', 'meal_type'],
        query_meals: ['period_from', 'period_to'],
        record_meal_from_image: [
          'hint_text',
          'image',
          'occurred_at',
          'timezone',
        ],
        record_meal_from_text: ['occurred_at', 'text', 'timezone'],
        search_foods: ['limit', 'queries'],
        update_profile: [
          'allergies',
          'constraints',
          'daily_targets',
          'dislikes',
          'likes',
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('marks search_foods as read-only', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'search_foods',
      )
      expect(tool?.annotations).toEqual({ readOnlyHint: true })
    } finally {
      await h.close()
    }
  })

  it('marks get_recommendation_context as read-only', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'get_recommendation_context',
      )
      expect(tool?.annotations).toEqual({ readOnlyHint: true })
    } finally {
      await h.close()
    }
  })
})

describe('record_meal_from_text', () => {
  it('returns structuredContent + content[].text and logs tool_called/tool_succeeded', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_text',
        arguments: {
          text: '白米 200g',
          occurred_at: '2026-06-12T12:30:00+09:00',
          timezone: 'Asia/Tokyo',
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: '白米 200g を記録しました。' }],
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'log-1',
              food_master_id: 'food-1',
              nutrition: { energy_kcal: 312 },
              is_estimated: false,
            },
          ],
          candidates: [],
          has_estimated_values: false,
          error: null,
        },
      })
      expect(h.calls.recordFromText).toEqual([
        {
          text: '白米 200g',
          occurredAt: new Date('2026-06-12T12:30:00+09:00'),
          timezone: 'Asia/Tokyo',
        },
      ])
      expect(h.logs.map((l) => l.event)).toEqual([
        'meshi.tool_called',
        'meshi.tool_succeeded',
      ])
    } finally {
      await h.close()
    }
  })

  it('rejects calls missing the required text field without invoking the orchestrator', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_text',
        arguments: {},
      })
      expect(normalizeValidationError(result)).toEqual({
        content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
        isError: true,
      })
      expect(h.calls.recordFromText).toEqual([])
      // Schema validation fails before the handler runs, so neither
      // tool_called nor tool_failed fires.
      expect(h.logs.map((l) => l.event)).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('marks the result as isError when the orchestrator surfaces an error', async () => {
    const h = await start({
      orchestratorOverrides: { recordFromText: erroredMealRecord },
    })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_text',
        arguments: { text: 'foo' },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: '処理が長くなったため中断しました。' }],
        structuredContent: {
          recorded: [],
          candidates: [],
          has_estimated_values: false,
          error: { kind: 'max_turns_exceeded', message: 'max turns' },
        },
        isError: true,
      })
      expect(h.logs.map((l) => l.event)).toEqual([
        'meshi.tool_called',
        'meshi.tool_failed',
      ])
    } finally {
      await h.close()
    }
  })

  it('returns isError, omits structuredContent, and emits tool_failed on orchestrator throw', async () => {
    const h = await start({
      orchestratorOverrides: { recordFromText: new Error('boom') },
    })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_text',
        arguments: { text: 'foo' },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'boom' }],
        isError: true,
      })
      expect(h.logs.map((l) => l.event)).toEqual([
        'meshi.tool_called',
        'meshi.tool_failed',
      ])
    } finally {
      await h.close()
    }
  })

  it('passes candidates through structuredContent when nothing was recorded', async () => {
    const h = await start({
      orchestratorOverrides: { recordFromText: candidateMealRecord },
    })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_text',
        arguments: { text: 'rice' },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: '食品を一意に特定できませんでした。' }],
        structuredContent: {
          recorded: [],
          candidates: [
            {
              food_master_id: 'food-9',
              composition_code: null,
              name: '白米',
              is_estimated: false,
              score: 0.5,
              reason: 'history_recent',
            },
          ],
          has_estimated_values: false,
          error: null,
        },
      })
    } finally {
      await h.close()
    }
  })
})

describe('record_meal_from_image', () => {
  const base64 = Buffer.from('hello').toString('base64')

  it('accepts MCP image content and bridges it to the orchestrator', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_from_image',
        arguments: {
          image: { type: 'image', mimeType: 'image/png', data: base64 },
          hint_text: 'ラーメン',
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: '白米 200g を記録しました。' }],
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'log-1',
              food_master_id: 'food-1',
              nutrition: { energy_kcal: 312 },
              is_estimated: false,
            },
          ],
          candidates: [],
          has_estimated_values: false,
          error: null,
        },
      })
      expect(h.calls.recordFromImage).toEqual([
        {
          image: { mimeType: 'image/png', base64 },
          hintText: 'ラーメン',
        },
      ])
    } finally {
      await h.close()
    }
  })

  it.each([
    {
      label: 'external https URL',
      data: 'https://example.com/photo.png',
      mimeType: 'image/png' as const,
    },
    {
      label: 'data: URL prefix',
      data: `data:image/png;base64,${base64}`,
      mimeType: 'image/png' as const,
    },
    {
      label: 'unsupported mime type',
      data: base64,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- intentionally probing an unsupported value to verify the enum constraint.
      mimeType: 'image/heic' as 'image/png',
    },
  ])(
    'rejects $label without invoking the orchestrator',
    async ({ data, mimeType }) => {
      const h = await start()
      try {
        const result = await h.client.callTool({
          name: 'record_meal_from_image',
          arguments: {
            image: { type: 'image', mimeType, data },
          },
        })
        expect(normalizeValidationError(result)).toEqual({
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        })
        expect(h.calls.recordFromImage).toEqual([])
        expect(h.logs.map((l) => l.event)).toEqual([])
      } finally {
        await h.close()
      }
    },
  )
})

describe('query_meals', () => {
  it('returns the selected period aggregate with actionable meal entries', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: '食事履歴を取得しました。' }],
        structuredContent: {
          totals: { energy_kcal: 1850 },
          per_day: [{ date: '2026-06-12', totals: { energy_kcal: 1850 } }],
          entries: [
            {
              meal_log_id: 'log-1',
              food_master_id: 'food-1',
              food_name: '白米',
              eaten_date: '2026-06-12',
              meal_type: 'lunch',
              quantity: 1,
              recorded_at: '2026-06-12T03:30:45Z',
            },
          ],
          has_estimated_values: false,
        },
      })
    } finally {
      await h.close()
    }
  })

  it('passes the selected half-open period to the meal history service', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(h.mealHistoryCalls.query).toEqual([
        { periodFrom: '2026-06-08', periodTo: '2026-06-15' },
      ])
    } finally {
      await h.close()
    }
  })

  it('does not invoke the LLM orchestrator', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(h.calls).toEqual({
        recordFromText: [],
        recordFromImage: [],
      })
    } finally {
      await h.close()
    }
  })

  it('logs the query lifecycle', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(h.logs).toEqual([
        {
          event: 'meshi.tool_called',
          payload: { tool: 'query_meals' },
        },
        {
          event: 'meshi.tool_succeeded',
          payload: { tool: 'query_meals' },
        },
      ])
    } finally {
      await h.close()
    }
  })

  it('requires both period boundary dates', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'query_meals',
        arguments: { period_from: '2026-06-08' },
      })
      expect(normalizeValidationError(result)).toEqual({
        content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })

  it('does not query history when a period boundary is missing', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'query_meals',
        arguments: { period_from: '2026-06-08' },
      })
      expect(h.mealHistoryCalls.query).toEqual([])
    } finally {
      await h.close()
    }
  })

  it('returns a structured tool error when the meal history service fails', async () => {
    const h = await start({
      mealHistoryOverrides: {
        query: new MealHistoryQueryError('query failed'),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'query failed' }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })

  it('converts an unexpected synchronous service throw into a tool error', async () => {
    const h = await start({
      mealHistoryOverrides: {
        query: () => {
          throw new Error('unexpected query failure')
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'unexpected query failure' }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })

  it('logs an unexpected synchronous service throw as a failed tool call', async () => {
    const h = await start({
      mealHistoryOverrides: {
        query: () => {
          throw new Error('unexpected query failure')
        },
      },
    })
    try {
      await h.client.callTool({
        name: 'query_meals',
        arguments: {
          period_from: '2026-06-08',
          period_to: '2026-06-15',
        },
      })
      expect(h.logs).toEqual([
        {
          event: 'meshi.tool_called',
          payload: { tool: 'query_meals' },
        },
        {
          event: 'meshi.tool_failed',
          payload: {
            tool: 'query_meals',
            code: 'internal_error',
            message: 'unexpected query failure',
          },
        },
      ])
    } finally {
      await h.close()
    }
  })
})

describe('get_recommendation_context', () => {
  it('returns the profile and selected-period history together', async () => {
    const h = await start({
      profile: recommendationProfile,
      mealHistoryOverrides: { query: recommendationHistory },
    })
    try {
      const result = await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(result).toEqual({
        content: [
          { type: 'text', text: 'プロフィールと食事履歴を取得しました。' },
        ],
        structuredContent: {
          profile: {
            likes: ['profile_favorite_alpha'],
            dislikes: ['profile_avoid_beta'],
            allergies: ['allergen_gamma'],
            constraints: ['diet_constraint_delta'],
            daily_targets: { energy_kcal: 2222, protein_g: 111 },
          },
          history: {
            totals: { energy_kcal: 701, protein_g: 27 },
            per_day: [
              {
                date: '2025-11-23',
                totals: { energy_kcal: 701, protein_g: 27 },
              },
            ],
            entries: [
              {
                meal_log_id: 'meal_log_delta',
                food_master_id: 'food_master_delta',
                food_name: 'sample_meal_delta',
                eaten_date: '2025-11-23',
                meal_type: 'breakfast',
                quantity: 1.25,
                recorded_at: '2025-11-23T04:05:06Z',
              },
            ],
            has_estimated_values: true,
          },
        },
      })
    } finally {
      await h.close()
    }
  })

  it('passes the selected period to the history service and reads the profile once', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(
        observation({
          historyCalls: h.mealHistoryCalls.query,
          profileCalls: h.profileCalls.get,
        }),
      ).toEqual({
        historyCalls: [{ periodFrom: '2025-11-20', periodTo: '2025-11-27' }],
        profileCalls: 1,
      })
    } finally {
      await h.close()
    }
  })

  it('does not invoke the LLM orchestrator', async () => {
    const h = await start()
    try {
      await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(h.calls).toEqual({
        recordFromText: [],
        recordFromImage: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns an error without context when profile retrieval fails', async () => {
    const h = await start({
      profileOverrides: {
        get: new UserProfileRepositoryError('profile unavailable'),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'profile unavailable' }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })

  it('returns an error without context when history retrieval fails', async () => {
    const h = await start({
      mealHistoryOverrides: {
        query: new MealHistoryQueryError('history unavailable'),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'history unavailable' }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })
})

describe('get_profile / update_profile', () => {
  it('returns the current profile from get_profile', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'get_profile',
        arguments: {},
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'プロファイルを取得しました。' }],
        structuredContent: {
          likes: ['rice'],
          dislikes: [],
          allergies: [],
          constraints: [],
          daily_targets: null,
        },
      })
      expect(h.profileCalls.get).toBe(1)
      expect(h.logs.map((l) => l.event)).toEqual([
        'meshi.tool_called',
        'meshi.tool_succeeded',
      ])
    } finally {
      await h.close()
    }
  })

  it('clears daily_targets when update_profile receives null', async () => {
    const h = await start({
      profile: {
        likes: ['rice'],
        dislikes: [],
        allergies: [],
        constraints: [],
        dailyTargets: { energy_kcal: 2000 },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'update_profile',
        arguments: { daily_targets: null },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'プロファイルを更新しました。' }],
        structuredContent: {
          likes: ['rice'],
          dislikes: [],
          allergies: [],
          constraints: [],
          daily_targets: null,
        },
      })
      expect(h.profileCalls.update).toEqual([{ dailyTargets: null }])
    } finally {
      await h.close()
    }
  })

  it('applies a partial update via update_profile', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'update_profile',
        arguments: {
          dislikes: ['natto'],
          daily_targets: { energy_kcal: 2000 },
        },
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'プロファイルを更新しました。' }],
        structuredContent: {
          likes: ['rice'],
          dislikes: ['natto'],
          allergies: [],
          constraints: [],
          daily_targets: { energy_kcal: 2000 },
        },
      })
      expect(h.profileCalls.update).toEqual([
        { dislikes: ['natto'], dailyTargets: { energy_kcal: 2000 } },
      ])
      expect(h.logs.map((l) => l.event)).toEqual([
        'meshi.tool_called',
        'meshi.tool_succeeded',
      ])
    } finally {
      await h.close()
    }
  })
})

describe('search_foods', () => {
  it('passes multiple search terms to the food service without calling the orchestrator', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: {
          queries: ['item_token_alpha', 'alpha item'],
          limit: 2,
        },
      })

      expect(
        observation({
          result,
          searchCalls: h.directMealToolCalls.foodSearch,
          orchestratorCalls: h.calls,
        }),
      ).toEqual({
        result: {
          content: [
            { type: 'text', text: '登録済み食品を 1 件取得しました。' },
          ],
          structuredContent: {
            foods: [
              {
                food_master_id: 'fm_catalog_alpha',
                name: 'item_token_alpha',
                energy_kcal: 42,
                is_estimated: false,
              },
            ],
          },
        },
        searchCalls: [
          { queries: ['item_token_alpha', 'alpha item'], limit: 2 },
        ],
        orchestratorCalls: {
          recordFromText: [],
          recordFromImage: [],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('returns null energy when enrichment is unavailable', async () => {
    const h = await start({
      foodSearchServiceResult: okAsync([
        {
          foodMasterId: 'fm_catalog_beta',
          name: 'item_token_beta',
          isEstimated: true,
          energyKcalPerUnit: null,
        },
      ]),
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: { queries: ['item_token_beta'] },
      })

      expect(result).toEqual({
        content: [{ type: 'text', text: '登録済み食品を 1 件取得しました。' }],
        structuredContent: {
          foods: [
            {
              food_master_id: 'fm_catalog_beta',
              name: 'item_token_beta',
              energy_kcal: null,
              is_estimated: true,
            },
          ],
        },
      })
    } finally {
      await h.close()
    }
  })
})

describe('record_meal_log', () => {
  it('records resolved food IDs directly without calling the orchestrator', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_log',
        arguments: {
          date: '2026-06-12',
          meal_type: 'lunch',
          items: [
            {
              food_master_id: 'fm_catalog_alpha',
              food_name: 'item_token_alpha',
              quantity: 2,
            },
          ],
        },
      })

      expect(
        observation({
          result,
          recordCalls: h.directMealToolCalls.recordMealLogs,
          orchestratorCalls: h.calls,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '1 品目を記録しました。' }],
          structuredContent: {
            recorded: [
              {
                meal_log_id: 'ml_tool_alpha',
                food_master_id: 'fm_catalog_alpha',
                food_name: 'item_token_alpha',
                quantity: 2,
                nutrition: { energy_kcal: 84, protein_g: 3 },
                is_estimated: false,
              },
            ],
            error: null,
          },
        },
        recordCalls: [
          {
            eatenDate: jstDate('2026-06-12'),
            mealType: 'lunch',
            items: [
              {
                foodMasterId: 'fm_catalog_alpha',
                foodName: 'item_token_alpha',
                quantity: 2,
              },
            ],
          },
        ],
        orchestratorCalls: {
          recordFromText: [],
          recordFromImage: [],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('rejects an empty item list before calling the meal log service', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_log',
        arguments: {
          date: '2026-06-12',
          meal_type: 'lunch',
          items: [],
        },
      })

      expect(
        observation({
          result: normalizeValidationError(result),
          recordCalls: h.directMealToolCalls.recordMealLogs,
          orchestratorCalls: h.calls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        recordCalls: [],
        orchestratorCalls: {
          recordFromText: [],
          recordFromImage: [],
        },
        logs: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns the invalid item position and domain error code', async () => {
    const h = await start({
      recordMealLogError: new MealLogItemValidationError(
        2,
        new InvalidQuantityError(0),
      ),
    })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_log',
        arguments: {
          date: '2026-06-12',
          meal_type: 'lunch',
          items: [
            {
              food_master_id: 'fm_catalog_alpha',
              food_name: 'item_token_alpha',
              quantity: 1,
            },
            {
              food_master_id: 'fm_catalog_beta',
              food_name: 'item_token_beta',
              quantity: 0,
            },
          ],
        },
      })

      expect(
        observation({
          result,
          recordCalls: h.directMealToolCalls.recordMealLogs,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          isError: true,
          content: [
            {
              type: 'text',
              text: 'item 2: quantity must be a finite positive number: 0',
            },
          ],
          structuredContent: {
            recorded: [],
            error: {
              item_index: 2,
              code: 'meal_log/invalid_quantity',
              message: 'item 2: quantity must be a finite positive number: 0',
            },
          },
        },
        recordCalls: [
          {
            eatenDate: jstDate('2026-06-12'),
            mealType: 'lunch',
            items: [
              {
                foodMasterId: 'fm_catalog_alpha',
                foodName: 'item_token_alpha',
                quantity: 1,
              },
              {
                foodMasterId: 'fm_catalog_beta',
                foodName: 'item_token_beta',
                quantity: 0,
              },
            ],
          },
        ],
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'record_meal_log' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'record_meal_log',
              code: 'meal_log/invalid_quantity',
              message: 'item 2: quantity must be a finite positive number: 0',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})
