import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it } from 'vitest'

import type {
  UserProfile,
  UserProfilePatch,
} from '@/domain/user-profile/user-profile'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import type {
  ConversationOrchestrator,
  MealHistoryResult,
  MealRecordResult,
  OrchestratorError,
  QueryMealsInput,
  RecommendInput,
  RecommendResult,
  RecordFromImageInput,
  RecordFromTextInput,
} from '@/llm/orchestrator'
import type { Logger } from '@/logger'
import { createMcpServer } from '@/mcp'

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

const successMealHistory: MealHistoryResult = {
  aggregate: {
    totals: { energy_kcal: 1850 },
    perDay: [{ date: '2026-06-12', totals: { energy_kcal: 1850 } }],
    entries: [
      {
        mealLogId: 'log-1',
        foodMasterId: 'food-1',
        eatenAtIso: '2026-06-12T12:30:00+09:00',
        quantity: 1,
        unit: '杯',
        note: null,
      },
    ],
    hasEstimatedValues: false,
  },
  hasEstimatedValues: false,
  summaryText: '集計結果...',
  error: null,
}

const successRecommend: RecommendResult = {
  summaryText: 'サバ味噌煮定食はどうでしょう',
  error: null,
}

interface OrchestratorCalls {
  recordFromText: RecordFromTextInput[]
  recordFromImage: RecordFromImageInput[]
  queryMeals: QueryMealsInput[]
  recommendMeal: RecommendInput[]
}

interface OrchestratorOverrides {
  recordFromText?: MealRecordResult | Error
  recordFromImage?: MealRecordResult | Error
  queryMeals?: MealHistoryResult | Error
  recommendMeal?: RecommendResult | Error
}

const makeOrchestrator = (
  overrides: OrchestratorOverrides = {},
): { orchestrator: ConversationOrchestrator; calls: OrchestratorCalls } => {
  const calls: OrchestratorCalls = {
    recordFromText: [],
    recordFromImage: [],
    queryMeals: [],
    recommendMeal: [],
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
    queryMeals(input) {
      calls.queryMeals.push(input)
      return resolve(overrides.queryMeals ?? successMealHistory)
    },
    recommendMeal(input) {
      calls.recommendMeal.push(input)
      return resolve(overrides.recommendMeal ?? successRecommend)
    },
  }
  return { orchestrator, calls }
}

const defaultProfile: UserProfile = {
  likes: ['rice'],
  dislikes: [],
  allergies: [],
  constraints: [],
}

interface ProfileCalls {
  get: number
  update: UserProfilePatch[]
}

const makeProfileService = (
  initial: UserProfile = defaultProfile,
  overrides: { get?: Error; update?: Error } = {},
): { service: UserProfileService; calls: ProfileCalls } => {
  let current = initial
  const calls: ProfileCalls = { get: 0, update: [] }
  const service: UserProfileService = {
    get() {
      calls.get++
      if (overrides.get) return Promise.reject(overrides.get)
      return Promise.resolve(current)
    },
    update(patch) {
      calls.update.push(patch)
      if (overrides.update) return Promise.reject(overrides.update)
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
      return Promise.resolve(current)
    },
  }
  return { service, calls }
}

interface Harness {
  client: Client
  logs: LogEntry[]
  calls: OrchestratorCalls
  profileCalls: ProfileCalls
  close: () => Promise<void>
}

interface HarnessConfig {
  orchestratorOverrides?: OrchestratorOverrides
  profileOverrides?: { get?: Error; update?: Error }
  profile?: UserProfile
}

const start = async (config: HarnessConfig = {}): Promise<Harness> => {
  const logs: LogEntry[] = []
  const logger = makeLogger(logs)
  const { orchestrator, calls } = makeOrchestrator(
    config.orchestratorOverrides ?? {},
  )
  const { service: profileService, calls: profileCalls } = makeProfileService(
    config.profile ?? defaultProfile,
    config.profileOverrides ?? {},
  )
  const server = createMcpServer({
    orchestrator,
    profileService,
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
    profileCalls,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

describe('MeshiMcpServer tools/list', () => {
  it('exposes the six public tools with stable names', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const names = result.tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'get_profile',
        'query_meals',
        'recommend_meal',
        'record_meal_from_image',
        'record_meal_from_text',
        'update_profile',
      ])
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
        query_meals: [
          'period_from_iso',
          'period_to_iso',
          'query_text',
          'timezone',
        ],
        recommend_meal: ['additional_constraints', 'timezone'],
        record_meal_from_image: [
          'hint_text',
          'image',
          'occurred_at',
          'timezone',
        ],
        record_meal_from_text: ['occurred_at', 'text', 'timezone'],
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
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: '白米 200g を記録しました。' },
      ])
      expect(result.structuredContent).toEqual({
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
      expect(result.isError ?? false).toBe(true)
      expect(result.structuredContent).toBeUndefined()
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
      expect(result.isError).toBe(true)
      expect(result.structuredContent).toEqual({
        recorded: [],
        candidates: [],
        has_estimated_values: false,
        error: { kind: 'max_turns_exceeded', message: 'max turns' },
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
      expect(result.isError).toBe(true)
      expect(result.content).toEqual([{ type: 'text', text: 'boom' }])
      expect(result.structuredContent).toBeUndefined()
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
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: '食品を一意に特定できませんでした。' },
      ])
      expect(result.structuredContent).toEqual({
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
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: '白米 200g を記録しました。' },
      ])
      expect(result.structuredContent).toEqual({
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
        expect(result.isError ?? false).toBe(true)
        expect(result.structuredContent).toBeUndefined()
        expect(h.calls.recordFromImage).toEqual([])
        expect(h.logs.map((l) => l.event)).toEqual([])
      } finally {
        await h.close()
      }
    },
  )
})

describe('query_meals', () => {
  it('returns aggregate structuredContent and the summary text', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'query_meals',
        arguments: {
          query_text: '今週のタンパク質',
          period_from_iso: '2026-06-08T00:00:00+09:00',
          period_to_iso: '2026-06-15T00:00:00+09:00',
        },
      })
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([{ type: 'text', text: '集計結果...' }])
      expect(result.structuredContent).toEqual({
        aggregate: {
          totals: { energy_kcal: 1850 },
          per_day: [{ date: '2026-06-12', totals: { energy_kcal: 1850 } }],
          entries: [
            {
              meal_log_id: 'log-1',
              food_master_id: 'food-1',
              eaten_at_iso: '2026-06-12T12:30:00+09:00',
              quantity: 1,
              unit: '杯',
              note: null,
            },
          ],
          has_estimated_values: false,
        },
        has_estimated_values: false,
        error: null,
      })
    } finally {
      await h.close()
    }
  })
})

describe('recommend_meal', () => {
  it('forwards additional_constraints to the orchestrator', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'recommend_meal',
        arguments: { additional_constraints: '軽め' },
      })
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: 'サバ味噌煮定食はどうでしょう' },
      ])
      expect(result.structuredContent).toEqual({ error: null })
      expect(h.calls.recommendMeal).toEqual([{ conditions: '軽め' }])
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
      expect(result.isError ?? false).toBe(false)
      expect(result.content).toEqual([
        { type: 'text', text: 'プロファイルを取得しました。' },
      ])
      expect(result.structuredContent).toEqual({
        likes: ['rice'],
        dislikes: [],
        allergies: [],
        constraints: [],
        daily_targets: null,
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
      expect(result.isError ?? false).toBe(false)
      expect(result.structuredContent).toEqual({
        likes: ['rice'],
        dislikes: [],
        allergies: [],
        constraints: [],
        daily_targets: null,
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
      expect(result.isError ?? false).toBe(false)
      expect(result.structuredContent).toEqual({
        likes: ['rice'],
        dislikes: ['natto'],
        allergies: [],
        constraints: [],
        daily_targets: { energy_kcal: 2000 },
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
