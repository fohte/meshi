import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type {
  FoodMaster,
  RegisterFoodMasterInput,
  RegisterFromCompositionInput,
} from '#domain/food-master/types'
import {
  type MealHistoryAggregate,
  MealHistoryQueryError,
  type MealHistoryService,
} from '#domain/meal-history/types'
import {
  DomainError,
  FutureEatenDateError,
  InvalidQuantityError,
  MealLogItemValidationError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type {
  MealLogDeletionResult,
  MealLogResult,
  RecordMealLogItemResult,
  RecordMealLogsInput,
  UpdateMealLogInput,
} from '#domain/meal-log/types'
import {
  FutureMealSkipDateError,
  type MealSkipDomainError,
  MealSkipNotFoundError,
} from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { UserProfileRepositoryError } from '#domain/user-profile/errors'
import type {
  UserProfile,
  UserProfilePatch,
} from '#domain/user-profile/user-profile'
import type { UserProfileService } from '#domain/user-profile/user-profile-service'
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

const successMealHistory: MealHistoryAggregate = {
  totals: { energy_kcal: 1850 },
  perDay: [
    {
      date: jstDate('2026-06-12'),
      totals: { energy_kcal: 1850 },
      hasUnknownValues: true,
    },
  ],
  entries: [
    {
      id: 'log-1',
      foodMasterId: 'food-1',
      foodName: '白米',
      eatenDate: jstDate('2026-06-12'),
      mealType: 'lunch',
      quantity: 1,
      recordedAt: '2026-06-12T03:30:45Z',
      nutritionStatus: 'confirmed',
    },
    {
      id: 'log-2',
      foodMasterId: 'unknown-food',
      foodName: 'unknown meal',
      eatenDate: jstDate('2026-06-12'),
      mealType: 'dinner',
      quantity: 1,
      recordedAt: '2026-06-12T05:30:45Z',
      nutritionStatus: 'unknown',
    },
  ],
  hasEstimatedValues: false,
  hasUnknownValues: true,
}

const searchFoodResults = [
  {
    foodMasterId: 'fm_catalog_alpha',
    compositionCode: null,
    name: 'item_token_alpha',
    isEstimated: false,
    nutritionStatus: 'confirmed' as const,
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
    nutritionStatus: 'confirmed',
  },
]

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
      hasUnknownValues: true,
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
      nutritionStatus: 'estimated',
    },
    {
      id: 'meal_log_epsilon',
      foodMasterId: 'food_master_epsilon',
      foodName: 'unknown meal',
      eatenDate: jstDate('2025-11-23'),
      mealType: 'dinner',
      quantity: 1,
      recordedAt: '2025-11-23T06:05:06Z',
      nutritionStatus: 'unknown',
    },
  ],
  hasEstimatedValues: true,
  hasUnknownValues: true,
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
  foodSearch: Array<{
    queries: ReadonlyArray<string>
    limit: number
    origin: 'retail' | 'homemade'
  }>
  recordMealLogs: RecordMealLogsInput[]
}

interface FoodMasterCalls {
  registerFromComposition: RegisterFromCompositionInput[]
  merge: {
    survivorId: string
    loserId: string
    dryRun: boolean
  }[]
}

const makeProfileService = (
  initial: UserProfile = defaultProfile,
  overrides: {
    get?: UserProfileRepositoryError | (() => never)
    update?: UserProfileRepositoryError
  } = {},
): { service: UserProfileService; calls: ProfileCalls } => {
  let current = initial
  const calls: ProfileCalls = { get: 0, update: [] }
  const service: UserProfileService = {
    get() {
      calls.get++
      if (typeof overrides.get === 'function') return overrides.get()
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

const testFoodMasters: ReadonlyArray<FoodMaster> = [
  {
    id: 'mcp_fixture_food_alpha',
    name: '試験用食品 A',
    aliases: [],
    isEstimated: false,
    nutritionStatus: 'confirmed',
    source: 'user_input',
    sourceUrl: null,
    sourceCompositionCode: null,
    nutrition: { energy_kcal: 137 },
    createdAt: new Date('2026-04-17T00:00:00.000Z'),
  },
  {
    id: 'mcp_fixture_food_beta',
    name: '試験用食品 B',
    aliases: [],
    isEstimated: true,
    nutritionStatus: 'estimated',
    source: 'user_input',
    sourceUrl: null,
    sourceCompositionCode: null,
    nutrition: { energy_kcal: 223 },
    createdAt: new Date('2026-04-17T00:00:00.000Z'),
  },
]

const makeFoodMasterService = (
  calls: FoodMasterCalls,
  registrationResult?: ReturnType<FoodMasterService['registerFromComposition']>,
  overrides: Partial<FoodMasterService> = {},
): FoodMasterService => {
  const foodMasters = new Map(testFoodMasters.map((food) => [food.id, food]))
  const unused = () =>
    errAsync(new FoodMasterDomainError('persistence_failed', 'not stubbed'))
  return {
    registerWithSimilarNameCheck: unused,
    getById: (id) => okAsync(foodMasters.get(id) ?? null),
    registerFromComposition(input) {
      calls.registerFromComposition.push(input)
      return registrationResult ?? unused()
    },
    findSimilarNames: () => okAsync([]),
    addAlias: () => okAsync(undefined),
    merge(survivorId, loserId, dryRun) {
      calls.merge.push({ survivorId, loserId, dryRun })
      return okAsync({
        survivorId,
        loserId,
        applied: !dryRun,
        movedAliases: ['alternate_label'],
        nameMovedAsAlias: 'removed_food_label',
        discardedNutrition: { energy_kcal: 118 },
        movedMealLogCount: 3,
      })
    },
    ...overrides,
  }
}

interface MealLogCalls {
  getById: string[]
  update: UpdateMealLogInput[]
  delete: string[]
  deleteMany: string[][]
}

const initialMealLog: MealLogResult = {
  id: 'mcp_fixture_meal_alpha',
  foodMasterId: 'mcp_fixture_food_alpha',
  eatenDate: jstDate('2026-04-17'),
  mealType: 'lunch',
  quantity: 1,
  createdAt: new Date('2026-04-17T03:30:45.000Z'),
  nutrition: { energy_kcal: 137 },
  isEstimated: false,
  nutritionStatus: 'confirmed',
}

const secondMealLog: MealLogResult = {
  id: 'mcp_fixture_meal_beta',
  foodMasterId: 'mcp_fixture_food_beta',
  eatenDate: jstDate('2026-04-17'),
  mealType: 'dinner',
  quantity: 2,
  createdAt: new Date('2026-04-17T04:30:45.000Z'),
  nutrition: { energy_kcal: 446 },
  isEstimated: true,
  nutritionStatus: 'estimated',
}

const makeMealLogService = (
  overrides: Partial<MealLogService> = {},
  deleteManyError?: DomainError,
): { service: MealLogService; calls: MealLogCalls } => {
  const records = new Map([
    [initialMealLog.id, initialMealLog],
    [secondMealLog.id, secondMealLog],
  ])
  const foodMasters = new Map(testFoodMasters.map((food) => [food.id, food]))
  const calls: MealLogCalls = {
    getById: [],
    update: [],
    delete: [],
    deleteMany: [],
  }
  const service: MealLogService = {
    record: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.record not stubbed'),
      ),
    recordMany: () =>
      errAsync(
        new MealLogPersistenceError('mealLogService.recordMany not stubbed'),
      ),
    update(input) {
      calls.update.push(input)
      const existing = records.get(input.id)
      if (existing === undefined) {
        return errAsync(new MealLogNotFoundError(input.id))
      }
      const foodMasterId = input.foodMasterId ?? existing.foodMasterId
      const food = foodMasters.get(foodMasterId)
      if (food === undefined) {
        return errAsync(
          new DomainError(
            `food_master not found: ${foodMasterId}`,
            'test/not_found',
          ),
        )
      }
      const updated: MealLogResult = {
        ...existing,
        foodMasterId,
        eatenDate: input.eatenDate ?? existing.eatenDate,
        mealType: input.mealType ?? existing.mealType,
        quantity: input.quantity ?? existing.quantity,
        nutrition: {
          energy_kcal:
            (food.nutrition['energy_kcal'] ?? 0) *
            (input.quantity ?? existing.quantity),
        },
        isEstimated: food.isEstimated,
        nutritionStatus: food.nutritionStatus,
      }
      records.set(input.id, updated)
      return okAsync(updated)
    },
    getById(id) {
      calls.getById.push(id)
      return okAsync(records.get(id) ?? null)
    },
    delete(id) {
      calls.delete.push(id)
      return records.delete(id)
        ? okAsync(undefined)
        : errAsync(new MealLogNotFoundError(id))
    },
    deleteMany(ids) {
      calls.deleteMany.push([...ids])
      if (deleteManyError !== undefined) return errAsync(deleteManyError)
      const missingId = ids.find((id) => !records.has(id))
      if (missingId !== undefined) {
        return errAsync(new MealLogNotFoundError(missingId))
      }

      const deleted: MealLogDeletionResult[] = []
      for (const id of ids) {
        const record = records.get(id)
        const food =
          record === undefined
            ? undefined
            : foodMasters.get(record.foodMasterId)
        if (record === undefined || food === undefined) {
          return errAsync(
            new DomainError(`meal_log not found: ${id}`, 'test/not_found'),
          )
        }
        deleted.push({
          id: record.id,
          foodMasterId: record.foodMasterId,
          foodName: food.name,
          eatenDate: record.eatenDate,
          mealType: record.mealType,
          quantity: record.quantity,
        })
      }
      for (const id of ids) records.delete(id)
      return okAsync(deleted)
    },
    ...overrides,
  }
  return { service, calls }
}

interface MealSkipCalls {
  record: Array<Parameters<MealSkipService['record']>[0]>
  cancel: Array<Parameters<MealSkipService['cancel']>[0]>
}

const makeMealSkipService = (
  errors: {
    record?: MealSkipDomainError
    cancel?: MealSkipDomainError
  } = {},
): { service: MealSkipService; calls: MealSkipCalls } => {
  const calls: MealSkipCalls = { record: [], cancel: [] }
  const service: MealSkipService = {
    record(input) {
      calls.record.push(input)
      if (errors.record !== undefined) {
        return errAsync(errors.record)
      }
      const row: MealSkipRow = {
        id: 'mcp_fixture_skip_alpha',
        date: input.date,
        mealType: input.mealType,
        createdAt: new Date('2026-04-17T03:30:45.000Z'),
      }
      return okAsync(row)
    },
    cancel(input) {
      calls.cancel.push(input)
      return errors.cancel === undefined
        ? okAsync(undefined)
        : errAsync(errors.cancel)
    },
    findForDate: () => okAsync([]),
  }
  return { service, calls }
}

interface Harness {
  client: Client
  logs: LogEntry[]
  mealHistoryCalls: MealHistoryCalls
  mealLogCalls: MealLogCalls
  mealSkipCalls: MealSkipCalls
  profileCalls: ProfileCalls
  foodMasterCalls: FoodMasterCalls
  directMealToolCalls: DirectMealToolCalls
  close: () => Promise<void>
}

interface HarnessConfig {
  mealHistoryOverrides?: {
    query?: MealHistoryAggregate | MealHistoryQueryError | (() => never)
  }
  profileOverrides?: {
    get?: UserProfileRepositoryError | (() => never)
    update?: UserProfileRepositoryError
  }
  mealLogOverrides?: Partial<MealLogService>
  deleteManyError?: DomainError
  mealSkipErrors?: {
    record?: MealSkipDomainError
    cancel?: MealSkipDomainError
  }
  profile?: UserProfile
  foodSearchServiceResult?: ReturnType<FoodSearchService['search']>
  recordMealLogResults?: ReadonlyArray<RecordMealLogItemResult>
  foodMasterRegistrationResult?: ReturnType<
    FoodMasterService['registerFromComposition']
  >
  recordMealLogError?: DomainError
  foodMasterOverrides?: Partial<FoodMasterService>
}

const start = async (config: HarnessConfig = {}): Promise<Harness> => {
  const logs: LogEntry[] = []
  const logger = makeLogger(logs)
  const { service: mealHistoryService, calls: mealHistoryCalls } =
    makeMealHistoryService(config.mealHistoryOverrides ?? {})
  const foodMasterCalls: FoodMasterCalls = {
    registerFromComposition: [],
    merge: [],
  }
  const foodMasterService = makeFoodMasterService(
    foodMasterCalls,
    config.foodMasterRegistrationResult,
    config.foodMasterOverrides,
  )
  const { service: mealLogCrudService, calls: mealLogCalls } =
    makeMealLogService(config.mealLogOverrides, config.deleteManyError)
  const { service: mealSkipService, calls: mealSkipCalls } =
    makeMealSkipService(config.mealSkipErrors)
  const { service: profileService, calls: profileCalls } = makeProfileService(
    config.profile ?? defaultProfile,
    config.profileOverrides ?? {},
  )
  const directMealToolCalls: DirectMealToolCalls = {
    foodSearch: [],
    recordMealLogs: [],
  }
  const foodSearchService: FoodSearchService = {
    search(queries, limit, origin = 'retail') {
      directMealToolCalls.foodSearch.push({ queries, limit, origin })
      return config.foodSearchServiceResult ?? okAsync(searchFoodResults)
    },
  }
  const mealLogService: MealLogService = {
    ...mealLogCrudService,
    recordMany(input) {
      directMealToolCalls.recordMealLogs.push(input)
      return config.recordMealLogError === undefined
        ? okAsync(config.recordMealLogResults ?? recordedMealLogItems)
        : errAsync(config.recordMealLogError)
    },
  }
  const server = createMcpServer({
    foodMasterService,
    mealHistoryService,
    mealLogService,
    mealSkipService,
    profileService,
    foodSearchService,
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
    mealHistoryCalls,
    mealLogCalls,
    mealSkipCalls,
    profileCalls,
    foodMasterCalls,
    directMealToolCalls,
    async close() {
      await client.close()
      await server.close()
    },
  }
}

describe('MeshiMcpServer tools/list', () => {
  it('exposes the thirteen public tools with stable names', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const names = result.tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'cancel_meal_skip',
        'delete_meal_log',
        'get_profile',
        'get_recommendation_context',
        'merge_food_master',
        'query_meals',
        'record_meal_log',
        'record_meal_skip',
        'register_food',
        'register_food_from_composition',
        'search_foods',
        'update_meal_log',
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

  it('only records meal skips when the user explicitly says they skipped a meal', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const descriptions = Object.fromEntries(
        result.tools
          .filter((tool) =>
            ['record_meal_skip', 'cancel_meal_skip'].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.description]),
      )
      expect(descriptions).toEqual({
        cancel_meal_skip:
          '以前に記録した食事スキップを取り消す。ユーザーがその食事を抜いていないと伝えた場合に使う。対象が存在しない場合はエラーになる。',
        record_meal_skip:
          'ユーザーが特定の日の特定の食事を抜いたと明言した場合だけ記録する。食事ログがないことだけを理由に記録しない。date は JST の YYYY-MM-DD、meal_type は breakfast / lunch / dinner / snack。',
      })
    } finally {
      await h.close()
    }
  })

  it('explains the evidence and naming rules for register_food', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const registerFood = result.tools.find(
        (tool) => tool.name === 'register_food',
      )
      expect(registerFood?.description).toEqual(
        '未登録の食品を登録し、food_master_id と名前を返す。nutrition.energy_kcal は必須。栄養値を一般知識から作らない。出典はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。name はブランド名を先頭に付け、残りは公式の商品名をそのまま書く。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。食品成分表に載っている自炊の素材は成分表から登録する。似た名前の候補が返されたら、同じ食品なら既存候補を使う。確信がなければ出典を調べ直すかユーザーに確認する。候補すべてと別物だと確認できた場合のみ、confirmed_distinct_from_master_ids に候補の food_master_id をすべて指定して再送する。',
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
        cancel_meal_skip: ['date', 'meal_type'],
        delete_meal_log: ['meal_log_ids'],
        get_profile: [],
        get_recommendation_context: ['period_from', 'period_to'],
        merge_food_master: [
          'dry_run',
          'loser_food_master_id',
          'survivor_food_master_id',
        ],
        query_meals: ['period_from', 'period_to'],
        record_meal_log: ['date', 'items', 'meal_type'],
        record_meal_skip: ['date', 'meal_type'],
        register_food_from_composition: ['aliases', 'composition_code', 'name'],
        search_foods: ['limit', 'origin', 'queries'],
        register_food: [
          'aliases',
          'confirmed_distinct_from_master_ids',
          'is_estimated',
          'name',
          'nutrition',
          'source',
          'source_url',
        ],
        update_meal_log: [
          'date',
          'food_master_id',
          'meal_log_id',
          'meal_type',
          'quantity',
        ],
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

  it('requires a date and meal type for both skip operations', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const requiredByTool = Object.fromEntries(
        result.tools
          .filter((tool) =>
            ['record_meal_skip', 'cancel_meal_skip'].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.inputSchema.required]),
      )
      expect(requiredByTool).toEqual({
        cancel_meal_skip: ['date', 'meal_type'],
        record_meal_skip: ['date', 'meal_type'],
      })
    } finally {
      await h.close()
    }
  })

  it('requires only composition_code for composition registration', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'register_food_from_composition',
      )
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- MCP SDK exposes a generic JSON Schema; this test reads its standard object fields.
      const inputSchema = tool?.inputSchema as {
        properties?: Record<string, unknown>
        required?: string[]
        additionalProperties?: boolean
      }
      expect(inputSchema.required).toEqual(['composition_code'])
    } finally {
      await h.close()
    }
  })

  it('rejects nutrition values for composition registration', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'register_food_from_composition',
        arguments: {
          composition_code: 'fc_composition_tool_alpha',
          nutrition: { energy_kcal: 42 },
        },
      })

      expect(
        observation({
          result: normalizeValidationError(result),
          registrationCalls: h.foodMasterCalls.registerFromComposition,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        registrationCalls: [],
      })
    } finally {
      await h.close()
    }
  })

  it('limits composition-table candidates to homemade ingredients', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const descriptions = Object.fromEntries(
        result.tools
          .filter((tool) =>
            ['search_foods', 'register_food_from_composition'].includes(
              tool.name,
            ),
          )
          .map((tool) => [tool.name, tool.description]),
      )
      expect(descriptions).toEqual({
        search_foods:
          '登録済み食品を複数の名前候補から検索し、食品名、kcal、栄養状態 (nutrition_status: confirmed / estimated / unknown) を返す。栄養値が不明な食品の kcal は null。origin が homemade の場合のみ食品成分表の候補も返す。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。成分表候補の energy_kcal は 100g あたり。',
        register_food_from_composition:
          '食品成分表の composition_code から食品マスタを登録する。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。栄養値は食品成分表から 100g あたりの値をコピーするため、入力では指定できない。',
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

  it('marks delete as destructive and update as non-destructive write tools', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const annotations = Object.fromEntries(
        result.tools
          .filter((tool) =>
            [
              'delete_meal_log',
              'merge_food_master',
              'update_meal_log',
            ].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.annotations]),
      )
      expect(annotations).toEqual({
        delete_meal_log: { readOnlyHint: false, destructiveHint: true },
        merge_food_master: { readOnlyHint: false, destructiveHint: true },
        update_meal_log: { readOnlyHint: false, destructiveHint: false },
      })
    } finally {
      await h.close()
    }
  })
  it('marks cancel_meal_skip as destructive and record_meal_skip as a non-destructive write tool', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const annotations = Object.fromEntries(
        result.tools
          .filter((tool) =>
            ['cancel_meal_skip', 'record_meal_skip'].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.annotations]),
      )
      expect(annotations).toEqual({
        cancel_meal_skip: { readOnlyHint: false, destructiveHint: true },
        record_meal_skip: { readOnlyHint: false, destructiveHint: false },
      })
    } finally {
      await h.close()
    }
  })

  it('explains the irreversible merge preview and survivor selection rules', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'merge_food_master',
      )
      expect(tool?.description).toEqual(
        '同じ食品を指す 2 つの食品マスタを統合する。survivor_food_master_id に残す食品、loser_food_master_id に統合する食品を指定する。survivor は、より信頼できる情報が揃っている食品を選ぶ。値が衝突した場合は survivor を優先し、loser の栄養情報はすべて破棄する。loser の別名と食事ログは survivor に移り、loser の名前は同じ文字列の別名が既に存在しない場合に survivor の別名へ加わる。dry_run は既定で true で、変更せずに移動・破棄の内容を返す。試し実行の結果をユーザーに見せて確認を得てから dry_run=false を指定する。実際に統合すると取り消せない。',
      )
    } finally {
      await h.close()
    }
  })

  it('requires both food master IDs and defaults dry_run to true', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'merge_food_master',
      )
      // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- MCP SDK exposes the JSON Schema as a generic record.
      const schema = tool?.inputSchema as {
        properties?: Record<string, unknown>
        required?: string[]
      }
      expect(
        observation({
          properties: schema.properties,
          required: schema.required,
        }),
      ).toEqual({
        properties: {
          survivor_food_master_id: { type: 'string', minLength: 1 },
          loser_food_master_id: { type: 'string', minLength: 1 },
          dry_run: { type: 'boolean', default: true },
        },
        required: ['survivor_food_master_id', 'loser_food_master_id'],
      })
    } finally {
      await h.close()
    }
  })
})

describe('merge_food_master', () => {
  it('defaults to a dry run and returns the merge plan', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'merge_food_master',
        arguments: {
          survivor_food_master_id: 'food_master_keep_test',
          loser_food_master_id: 'food_master_remove_test',
        },
      })
      expect(observation({ result, calls: h.foodMasterCalls.merge })).toEqual({
        result: {
          content: [
            { type: 'text', text: '食品マスタ統合の試し実行結果です。' },
          ],
          structuredContent: {
            survivor_food_master_id: 'food_master_keep_test',
            loser_food_master_id: 'food_master_remove_test',
            applied: false,
            moved_aliases: ['alternate_label'],
            name_moved_as_alias: 'removed_food_label',
            discarded_nutrition: { energy_kcal: 118 },
            moved_meal_log_count: 3,
          },
        },
        calls: [
          {
            survivorId: 'food_master_keep_test',
            loserId: 'food_master_remove_test',
            dryRun: true,
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('applies the merge only when dry_run is false', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'merge_food_master',
        arguments: {
          survivor_food_master_id: 'food_master_keep_test',
          loser_food_master_id: 'food_master_remove_test',
          dry_run: false,
        },
      })
      expect(observation({ result, calls: h.foodMasterCalls.merge })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品マスタを統合しました。' }],
          structuredContent: {
            survivor_food_master_id: 'food_master_keep_test',
            loser_food_master_id: 'food_master_remove_test',
            applied: true,
            moved_aliases: ['alternate_label'],
            name_moved_as_alias: 'removed_food_label',
            discarded_nutrition: { energy_kcal: 118 },
            moved_meal_log_count: 3,
          },
        },
        calls: [
          {
            survivorId: 'food_master_keep_test',
            loserId: 'food_master_remove_test',
            dryRun: false,
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns merge errors with a domain code and failed log', async () => {
    const message = 'survivor and loser must be different food_master rows'
    const h = await start({
      foodMasterOverrides: {
        merge: () =>
          errAsync(new FoodMasterDomainError('same_food_master', message)),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'merge_food_master',
        arguments: {
          survivor_food_master_id: 'food_master_keep_test',
          loser_food_master_id: 'food_master_remove_test',
        },
      })

      expect(observation({ result, logs: h.logs })).toEqual({
        result: {
          isError: true,
          content: [{ type: 'text', text: message }],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'merge_food_master' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'merge_food_master',
              code: 'food_master/same_food_master',
              message,
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
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
          per_day: [
            {
              date: '2026-06-12',
              totals: { energy_kcal: 1850 },
              has_unknown_values: true,
            },
          ],
          entries: [
            {
              meal_log_id: 'log-1',
              food_master_id: 'food-1',
              food_name: '白米',
              eaten_date: '2026-06-12',
              meal_type: 'lunch',
              quantity: 1,
              recorded_at: '2026-06-12T03:30:45Z',
              nutrition_status: 'confirmed',
            },
            {
              meal_log_id: 'log-2',
              food_master_id: 'unknown-food',
              food_name: 'unknown meal',
              eaten_date: '2026-06-12',
              meal_type: 'dinner',
              quantity: 1,
              recorded_at: '2026-06-12T05:30:45Z',
              nutrition_status: 'unknown',
            },
          ],
          has_estimated_values: false,
          has_unknown_values: true,
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

describe('delete_meal_log', () => {
  it('deletes all entries and returns their contents', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'delete_meal_log',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_alpha', 'mcp_fixture_meal_beta'],
        },
      })
      expect(
        observation({
          result,
          mealLogCalls: h.mealLogCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '2 件の食事ログを削除しました。' }],
          structuredContent: {
            deleted: [
              {
                meal_log_id: 'mcp_fixture_meal_alpha',
                food_master_id: 'mcp_fixture_food_alpha',
                food_name: '試験用食品 A',
                eaten_date: '2026-04-17',
                meal_type: 'lunch',
                quantity: 1,
              },
              {
                meal_log_id: 'mcp_fixture_meal_beta',
                food_master_id: 'mcp_fixture_food_beta',
                food_name: '試験用食品 B',
                eaten_date: '2026-04-17',
                meal_type: 'dinner',
                quantity: 2,
              },
            ],
          },
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [['mcp_fixture_meal_alpha', 'mcp_fixture_meal_beta']],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'delete_meal_log' },
          },
          {
            event: 'meshi.tool_succeeded',
            payload: { tool: 'delete_meal_log', deleted: 2 },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('does not delete any entry when one requested ID does not exist', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'delete_meal_log',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_alpha', 'mcp_fixture_meal_missing'],
        },
      })
      expect(
        observation({ result, mealLogCalls: h.mealLogCalls, logs: h.logs }),
      ).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: 'meal_log not found: mcp_fixture_meal_missing',
            },
          ],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [['mcp_fixture_meal_alpha', 'mcp_fixture_meal_missing']],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'delete_meal_log' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'delete_meal_log',
              code: 'MealLogNotFoundError',
              message: 'meal_log not found: mcp_fixture_meal_missing',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('requires at least one unique meal_log_id', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'delete_meal_log',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_alpha', 'mcp_fixture_meal_alpha'],
        },
      })
      expect(
        observation({
          result: normalizeValidationError(result),
          mealLogCalls: h.mealLogCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [],
        },
        logs: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns a service error when the atomic delete fails', async () => {
    const h = await start({
      deleteManyError: new MealLogPersistenceError('bulk delete failed'),
    })
    try {
      const result = await h.client.callTool({
        name: 'delete_meal_log',
        arguments: { meal_log_ids: ['mcp_fixture_meal_alpha'] },
      })
      expect(
        observation({ result, mealLogCalls: h.mealLogCalls, logs: h.logs }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: 'bulk delete failed' }],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [['mcp_fixture_meal_alpha']],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'delete_meal_log' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'delete_meal_log',
              code: 'MealLogPersistenceError',
              message: 'bulk delete failed',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})

describe('record_meal_skip', () => {
  it('records the explicitly skipped meal and returns its structured identity', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_skip',
        arguments: { date: '2026-04-17', meal_type: 'breakfast' },
      })
      expect(
        observation({
          result,
          mealSkipCalls: h.mealSkipCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '食事スキップを記録しました。' }],
          structuredContent: {
            meal_skip_id: 'mcp_fixture_skip_alpha',
            date: '2026-04-17',
            meal_type: 'breakfast',
          },
        },
        mealSkipCalls: {
          record: [{ date: '2026-04-17', mealType: 'breakfast' }],
          cancel: [],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'record_meal_skip' },
          },
          {
            event: 'meshi.tool_succeeded',
            payload: { tool: 'record_meal_skip' },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('rejects invalid meal types before calling the service', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'record_meal_skip',
        arguments: { date: '2026-04-17', meal_type: 'brunch' },
      })
      expect(
        observation({
          result: normalizeValidationError(result),
          mealSkipCalls: h.mealSkipCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        mealSkipCalls: { record: [], cancel: [] },
        logs: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns the domain error when the requested date is in the future', async () => {
    const error = new FutureMealSkipDateError(jstDate('2099-04-18'))
    const h = await start({ mealSkipErrors: { record: error } })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_skip',
        arguments: { date: '2099-04-18', meal_type: 'breakfast' },
      })
      expect(
        observation({ result, mealSkipCalls: h.mealSkipCalls, logs: h.logs }),
      ).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: 'date must not be in the future: 2099-04-18',
            },
          ],
          isError: true,
        },
        mealSkipCalls: {
          record: [{ date: '2099-04-18', mealType: 'breakfast' }],
          cancel: [],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'record_meal_skip' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'record_meal_skip',
              code: 'FutureMealSkipDateError',
              message: 'date must not be in the future: 2099-04-18',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})

describe('cancel_meal_skip', () => {
  it('cancels the specified meal skip', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'cancel_meal_skip',
        arguments: { date: '2026-04-17', meal_type: 'breakfast' },
      })
      expect(
        observation({
          result,
          mealSkipCalls: h.mealSkipCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '食事スキップを取り消しました。' }],
          structuredContent: {
            date: '2026-04-17',
            meal_type: 'breakfast',
          },
        },
        mealSkipCalls: {
          record: [],
          cancel: [{ date: '2026-04-17', mealType: 'breakfast' }],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'cancel_meal_skip' },
          },
          {
            event: 'meshi.tool_succeeded',
            payload: { tool: 'cancel_meal_skip' },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns the domain error when no skip exists for the date and meal', async () => {
    const error = new MealSkipNotFoundError(jstDate('2026-04-17'), 'breakfast')
    const h = await start({ mealSkipErrors: { cancel: error } })
    try {
      const result = await h.client.callTool({
        name: 'cancel_meal_skip',
        arguments: { date: '2026-04-17', meal_type: 'breakfast' },
      })
      expect(
        observation({ result, mealSkipCalls: h.mealSkipCalls, logs: h.logs }),
      ).toEqual({
        result: {
          content: [
            { type: 'text', text: 'meal_skip not found: 2026-04-17 breakfast' },
          ],
          isError: true,
        },
        mealSkipCalls: {
          record: [],
          cancel: [{ date: '2026-04-17', mealType: 'breakfast' }],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'cancel_meal_skip' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'cancel_meal_skip',
              code: 'MealSkipNotFoundError',
              message: 'meal_skip not found: 2026-04-17 breakfast',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})

describe('update_meal_log', () => {
  it('passes the patch to MealLogService and returns updated content with nutrition', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: {
          meal_log_id: 'mcp_fixture_meal_alpha',
          food_master_id: 'mcp_fixture_food_beta',
          date: '2026-04-18',
          meal_type: 'dinner',
          quantity: 2,
        },
      })
      expect(
        observation({
          result,
          mealLogCalls: h.mealLogCalls,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '食事ログを更新しました。' }],
          structuredContent: {
            meal_log_id: 'mcp_fixture_meal_alpha',
            food_master_id: 'mcp_fixture_food_beta',
            food_name: '試験用食品 B',
            eaten_date: '2026-04-18',
            meal_type: 'dinner',
            quantity: 2,
            nutrition: { energy_kcal: 446 },
            is_estimated: true,
          },
        },
        mealLogCalls: {
          getById: [],
          update: [
            {
              id: 'mcp_fixture_meal_alpha',
              foodMasterId: 'mcp_fixture_food_beta',
              eatenDate: '2026-04-18',
              mealType: 'dinner',
              quantity: 2,
            },
          ],
          delete: [],
          deleteMany: [],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('requires at least one field to update', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: { meal_log_id: 'mcp_fixture_meal_alpha' },
      })
      expect(
        observation({
          result: normalizeValidationError(result),
          mealLogCalls: h.mealLogCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [],
        },
        logs: [],
      })
    } finally {
      await h.close()
    }
  })

  it('rejects non-positive quantities at the MCP boundary', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: { meal_log_id: 'mcp_fixture_meal_alpha', quantity: 0 },
      })
      expect(
        observation({
          result: normalizeValidationError(result),
          mealLogCalls: h.mealLogCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [],
          delete: [],
          deleteMany: [],
        },
        logs: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns domain validation errors as tool errors', async () => {
    const futureDate = jstDate('2030-01-01')
    const attemptedUpdates: UpdateMealLogInput[] = []
    const h = await start({
      mealLogOverrides: {
        update: (input) => {
          attemptedUpdates.push(input)
          return errAsync(new FutureEatenDateError(futureDate))
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: { meal_log_id: 'log-1', date: futureDate },
      })
      expect(observation({ result, attemptedUpdates, logs: h.logs })).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: 'eaten_date must not be in the future: 2030-01-01',
            },
          ],
          isError: true,
        },
        attemptedUpdates: [{ id: 'log-1', eatenDate: '2030-01-01' }],
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'update_meal_log' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'update_meal_log',
              code: 'FutureEatenDateError',
              message: 'eaten_date must not be in the future: 2030-01-01',
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns a not-found error for an unknown meal_log_id', async () => {
    const h = await start()
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: { meal_log_id: 'mcp_fixture_meal_missing', quantity: 2 },
      })
      expect(observation({ result, mealLogCalls: h.mealLogCalls })).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: 'meal_log not found: mcp_fixture_meal_missing',
            },
          ],
          isError: true,
        },
        mealLogCalls: {
          getById: [],
          update: [{ id: 'mcp_fixture_meal_missing', quantity: 2 }],
          delete: [],
          deleteMany: [],
        },
      })
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
                has_unknown_values: true,
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
                nutrition_status: 'estimated',
              },
              {
                meal_log_id: 'meal_log_epsilon',
                food_master_id: 'food_master_epsilon',
                food_name: 'unknown meal',
                eaten_date: '2025-11-23',
                meal_type: 'dinner',
                quantity: 1,
                recorded_at: '2025-11-23T06:05:06Z',
                nutrition_status: 'unknown',
              },
            ],
            has_estimated_values: true,
            has_unknown_values: true,
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

  it('returns an error without context when profile retrieval throws', async () => {
    const h = await start({
      profileOverrides: {
        get: () => {
          throw new Error('unexpected profile failure')
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'unexpected profile failure' }],
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

  it('returns an error without context when history retrieval throws', async () => {
    const h = await start({
      mealHistoryOverrides: {
        query: () => {
          throw new Error('unexpected history failure')
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'get_recommendation_context',
        arguments: recommendationPeriod,
      })
      expect(result).toEqual({
        content: [{ type: 'text', text: 'unexpected history failure' }],
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
  it('passes multiple search terms to the food service', async () => {
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
                composition_code: null,
                name: 'item_token_alpha',
                energy_kcal: 42,
                is_estimated: false,
                nutrition_status: 'confirmed',
              },
            ],
          },
        },
        searchCalls: [
          {
            queries: ['item_token_alpha', 'alpha item'],
            limit: 2,
            origin: 'retail',
          },
        ],
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
          compositionCode: null,
          name: 'item_token_beta',
          isEstimated: true,
          nutritionStatus: 'estimated',
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
              composition_code: null,
              name: 'item_token_beta',
              energy_kcal: null,
              is_estimated: true,
              nutrition_status: 'estimated',
            },
          ],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('returns composition candidates and their per-100g kcal for homemade searches', async () => {
    const h = await start({
      foodSearchServiceResult: okAsync([
        {
          foodMasterId: 'fm_search_fixture_alpha',
          compositionCode: null,
          name: 'search_fixture_alpha',
          isEstimated: false,
          nutritionStatus: 'confirmed' as const,
          energyKcalPerUnit: 42,
        },
        {
          foodMasterId: null,
          compositionCode: 'fc_search_fixture_beta',
          name: 'search_fixture_beta',
          isEstimated: true,
          nutritionStatus: 'estimated',
          energyKcalPer100g: 88,
        },
      ]),
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: {
          queries: ['search_fixture_alpha', 'search_fixture_beta'],
          origin: 'homemade',
        },
      })

      expect(
        observation({
          result,
          searchCalls: h.directMealToolCalls.foodSearch,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: '食品候補を 2 件取得しました。' }],
          structuredContent: {
            foods: [
              {
                food_master_id: 'fm_search_fixture_alpha',
                composition_code: null,
                name: 'search_fixture_alpha',
                energy_kcal: 42,
                is_estimated: false,
                nutrition_status: 'confirmed',
              },
              {
                food_master_id: null,
                composition_code: 'fc_search_fixture_beta',
                name: 'search_fixture_beta',
                energy_kcal: 88,
                is_estimated: true,
                nutrition_status: 'estimated',
              },
            ],
          },
        },
        searchCalls: [
          {
            queries: ['search_fixture_alpha', 'search_fixture_beta'],
            limit: 10,
            origin: 'homemade',
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns unknown status and null energy for a food without nutrition metadata', async () => {
    const h = await start({
      foodSearchServiceResult: okAsync([
        {
          foodMasterId: 'fm_catalog_unknown',
          compositionCode: null,
          name: 'unknown menu',
          isEstimated: false,
          nutritionStatus: 'unknown',
          energyKcalPerUnit: null,
        },
      ]),
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: { queries: ['unknown menu'] },
      })

      expect(result).toEqual({
        content: [{ type: 'text', text: '登録済み食品を 1 件取得しました。' }],
        structuredContent: {
          foods: [
            {
              food_master_id: 'fm_catalog_unknown',
              composition_code: null,
              name: 'unknown menu',
              energy_kcal: null,
              is_estimated: false,
              nutrition_status: 'unknown',
            },
          ],
        },
      })
    } finally {
      await h.close()
    }
  })
})

describe('register_food_from_composition', () => {
  it('registers a composition-backed food', async () => {
    const foodMaster: FoodMaster = {
      id: 'fm_composition_tool_alpha',
      name: 'composition_tool_alpha',
      aliases: ['composition_tool_alias'],
      isEstimated: true,
      nutritionStatus: 'estimated',
      source: 'composition_table_estimate',
      sourceUrl: null,
      sourceCompositionCode: 'fc_composition_tool_alpha',
      nutrition: { energy_kcal: 92 },
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    }
    const h = await start({
      foodMasterRegistrationResult: okAsync({
        foodMaster,
        compositionName: 'composition_tool_source_alpha',
      }),
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food_from_composition',
        arguments: {
          composition_code: 'fc_composition_tool_alpha',
          name: 'composition_tool_alpha',
          aliases: ['composition_tool_alias'],
        },
      })

      expect(
        observation({
          result,
          foodMasterCalls: h.foodMasterCalls,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [
            { type: 'text', text: '食品成分表から食品を登録しました。' },
          ],
          structuredContent: {
            food_master_id: 'fm_composition_tool_alpha',
            name: 'composition_tool_alpha',
          },
        },
        foodMasterCalls: {
          registerFromComposition: [
            {
              compositionCode: 'fc_composition_tool_alpha',
              name: 'composition_tool_alpha',
              aliases: ['composition_tool_alias'],
            },
          ],
          merge: [],
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'register_food_from_composition' },
          },
          {
            event: 'meshi.tool_succeeded',
            payload: { tool: 'register_food_from_composition' },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns composition lookup errors with a domain code', async () => {
    const compositionCode = 'fc_composition_missing'
    const message = `food_composition not found: ${compositionCode}`
    const h = await start({
      foodMasterRegistrationResult: errAsync(
        new FoodMasterDomainError('composition_not_found', message),
      ),
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food_from_composition',
        arguments: { composition_code: compositionCode },
      })

      expect(
        observation({
          result,
          registrationCalls: h.foodMasterCalls.registerFromComposition,
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          isError: true,
          content: [{ type: 'text', text: message }],
        },
        registrationCalls: [{ compositionCode }],
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'register_food_from_composition' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'register_food_from_composition',
              code: 'food_master/composition_not_found',
              message,
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})

describe('register_food', () => {
  it('registers the supplied one-unit nutrition through FoodMasterService', async () => {
    const calls: Array<{
      input: RegisterFoodMasterInput
      confirmedDistinctFromMasterIds?: ReadonlyArray<string>
    }> = []
    const h = await start({
      foodMasterOverrides: {
        registerWithSimilarNameCheck: (
          input,
          confirmedDistinctFromMasterIds,
        ) => {
          calls.push({
            input,
            ...(confirmedDistinctFromMasterIds === undefined
              ? {}
              : { confirmedDistinctFromMasterIds }),
          })
          const foodMaster: FoodMaster = {
            id: 'fm_registered_alpha',
            name: input.name,
            aliases: input.aliases ?? [],
            isEstimated: input.isEstimated,
            nutritionStatus: input.isEstimated ? 'estimated' : 'confirmed',
            source: input.source,
            sourceUrl: input.sourceUrl ?? null,
            sourceCompositionCode: null,
            nutrition: input.nutrition,
            createdAt: new Date('2026-04-17T00:00:00.000Z'),
          }
          return okAsync(foodMaster)
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food',
        arguments: {
          name: 'Sample Pantry cereal blend',
          aliases: ['sample cereal mix'],
          nutrition: { energy_kcal: 137, protein_g: 2.5 },
          source: 'web_search',
          is_estimated: false,
          source_url: 'https://example.test/items/sample-cereal',
          confirmed_distinct_from_master_ids: ['fm_candidate_alpha'],
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品を登録しました。' }],
          structuredContent: {
            food_master_id: 'fm_registered_alpha',
            name: 'Sample Pantry cereal blend',
          },
        },
        calls: [
          {
            input: {
              name: 'Sample Pantry cereal blend',
              aliases: ['sample cereal mix'],
              nutrition: { energy_kcal: 137, protein_g: 2.5 },
              source: 'web_search',
              isEstimated: false,
              sourceUrl: 'https://example.test/items/sample-cereal',
            },
            confirmedDistinctFromMasterIds: ['fm_candidate_alpha'],
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('rejects nutrition without energy_kcal before calling FoodMasterService', async () => {
    const calls: Array<{ input: RegisterFoodMasterInput }> = []
    const h = await start({
      foodMasterOverrides: {
        registerWithSimilarNameCheck: (input) => {
          calls.push({ input })
          return errAsync(
            new FoodMasterDomainError('persistence_failed', 'should not run'),
          )
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food',
        arguments: {
          name: 'Sample Pantry cereal blend',
          nutrition: { protein_g: 2.5 },
          source: 'user_input',
          is_estimated: false,
        },
      })

      expect(
        observation({ result: normalizeValidationError(result), calls }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        calls: [],
      })
    } finally {
      await h.close()
    }
  })

  it('returns similar-name candidates in the structured error', async () => {
    const calls: Array<{
      input: RegisterFoodMasterInput
      confirmedDistinctFromMasterIds?: ReadonlyArray<string>
    }> = []
    const message =
      'existing food_master(s) with a similar name were found; reuse one of them if it is the same product, gather stronger evidence and retry if unsure, ask the user to disambiguate, or retry with confirmed_distinct_from_master_ids listing exactly these food_master_id values once you have verified this is a different product'
    const h = await start({
      foodMasterOverrides: {
        registerWithSimilarNameCheck: (
          input,
          confirmedDistinctFromMasterIds,
        ) => {
          calls.push({
            input,
            ...(confirmedDistinctFromMasterIds === undefined
              ? {}
              : { confirmedDistinctFromMasterIds }),
          })
          return errAsync(
            new FoodMasterDomainError('similar_name_exists', message, {
              candidates: [
                {
                  food_master_id: 'fm_candidate_alpha',
                  name: 'Sample Pantry cereal bites',
                  score: 0.73,
                },
              ],
            }),
          )
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food',
        arguments: {
          name: 'Sample Pantry cereal blend',
          nutrition: { energy_kcal: 137 },
          source: 'user_input',
          is_estimated: false,
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          isError: true,
          content: [{ type: 'text', text: message }],
          structuredContent: {
            error: {
              code: 'food_master/similar_name_exists',
              message,
              candidates: [
                {
                  food_master_id: 'fm_candidate_alpha',
                  name: 'Sample Pantry cereal bites',
                  score: 0.73,
                },
              ],
            },
          },
        },
        calls: [
          {
            input: {
              name: 'Sample Pantry cereal blend',
              nutrition: { energy_kcal: 137 },
              source: 'user_input',
              isEstimated: false,
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })
})

describe('record_meal_log', () => {
  it('records resolved food IDs directly', async () => {
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
                nutrition_status: 'confirmed',
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
      })
    } finally {
      await h.close()
    }
  })

  it('returns unknown status when the recorded food has no nutrition metadata', async () => {
    const h = await start({
      recordMealLogResults: [
        {
          id: 'ml_tool_unknown',
          foodMasterId: 'fm_catalog_unknown',
          foodName: 'unknown menu',
          eatenDate: jstDate('2026-06-12'),
          mealType: 'dinner',
          quantity: 1,
          createdAt: new Date('2026-06-12T05:00:00.000Z'),
          nutrition: {},
          isEstimated: false,
          nutritionStatus: 'unknown',
        },
      ],
    })
    try {
      const result = await h.client.callTool({
        name: 'record_meal_log',
        arguments: {
          date: '2026-06-12',
          meal_type: 'dinner',
          items: [
            {
              food_master_id: 'fm_catalog_unknown',
              food_name: 'unknown menu',
              quantity: 1,
            },
          ],
        },
      })

      expect(result).toEqual({
        content: [{ type: 'text', text: '1 品目を記録しました。' }],
        structuredContent: {
          recorded: [
            {
              meal_log_id: 'ml_tool_unknown',
              food_master_id: 'fm_catalog_unknown',
              food_name: 'unknown menu',
              quantity: 1,
              nutrition: {},
              is_estimated: false,
              nutrition_status: 'unknown',
            },
          ],
          error: null,
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
          logs: h.logs,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
          isError: true,
        },
        recordCalls: [],
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
