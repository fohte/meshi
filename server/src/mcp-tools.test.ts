import { Client, InMemoryTransport } from '@modelcontextprotocol/client'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { FoodSearchService } from '#domain/food-browse/food-search-service'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type {
  AddFoodMasterNutritionVersionInput,
  FillFoodNutritionInput,
  FoodMaster,
  FoodMasterNutritionVersion,
  RegisterFoodMasterInput,
  RegisterFoodMasterWithoutNutritionInput,
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
import type { MealLogNutritionReassignmentService } from '#domain/meal-log/nutrition-reassignment'
import type {
  MealLogDeletionResult,
  MealLogResult,
  RecordMealLogItemResult,
  RecordMealLogsInput,
  UpdateMealLogInput,
} from '#domain/meal-log/types'
import {
  EmptyMealSetItemsError,
  MealSetPersistenceError,
} from '#domain/meal-set/errors'
import type { MealSetService } from '#domain/meal-set/meal-set-service'
import type { MealSet, RegisterMealSetInput } from '#domain/meal-set/types'
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
import { createStubMcpDeps } from '#test/mcp-stubs'

const VALIDATION_ERROR_TEXT = '<schema validation error>'

type MealLogNutritionReassignmentInput = Parameters<
  MealLogNutritionReassignmentService['reassign']
>[0]
type MealLogNutritionReassignmentResult = ReturnType<
  Awaited<
    ReturnType<MealLogNutritionReassignmentService['reassign']>
  >['_unsafeUnwrap']
>

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
  incompleteNutrients: ['energy_kcal'],
  perDay: [
    {
      date: jstDate('2026-06-12'),
      totals: { energy_kcal: 1850 },
      incompleteNutrients: ['energy_kcal'],
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
    lastEatenDate: jstDate('2026-01-02'),
    lastQuantity: 1.5,
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
  incompleteNutrients: ['energy_kcal', 'protein_g'],
  perDay: [
    {
      date: jstDate('2025-11-23'),
      totals: { energy_kcal: 701, protein_g: 27 },
      incompleteNutrients: ['energy_kcal', 'protein_g'],
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
  mealSetSearchQueries: string[]
  registerMealSets: RegisterMealSetInput[]
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
    fillNutrition: unused,
    addNutritionVersion: unused,
    listNutritionVersions: unused,
    registerWithSimilarNameCheck: unused,
    registerWithoutNutritionWithSimilarNameCheck: unused,
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
        movedNutritionVersions: [{ previousVersionNo: 1, versionNo: 2 }],
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
  mealSetServiceOverrides?: Partial<MealSetService>
  recordMealLogResults?: ReadonlyArray<RecordMealLogItemResult>
  foodMasterRegistrationResult?: ReturnType<
    FoodMasterService['registerFromComposition']
  >
  recordMealLogError?: DomainError
  foodMasterOverrides?: Partial<FoodMasterService>
  mealLogNutritionReassignmentService?: Partial<MealLogNutritionReassignmentService>
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
    mealSetSearchQueries: [],
    registerMealSets: [],
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
  const mealLogNutritionReassignmentService: MealLogNutritionReassignmentService =
    {
      ...createStubMcpDeps().mealLogNutritionReassignmentService,
      ...config.mealLogNutritionReassignmentService,
    }
  const mealSetService: MealSetService = {
    register(input) {
      directMealToolCalls.registerMealSets.push(input)
      return (
        config.mealSetServiceOverrides?.register?.(input) ??
        errAsync(new MealSetPersistenceError('stub'))
      )
    },
    list: () =>
      config.mealSetServiceOverrides?.list?.() ??
      errAsync(new MealSetPersistenceError('stub')),
    getById: (id) =>
      config.mealSetServiceOverrides?.getById?.(id) ??
      errAsync(new MealSetPersistenceError('stub')),
    update: (input) =>
      config.mealSetServiceOverrides?.update?.(input) ??
      errAsync(new MealSetPersistenceError('stub')),
    delete: (id) =>
      config.mealSetServiceOverrides?.delete?.(id) ??
      errAsync(new MealSetPersistenceError('stub')),
    searchByName(name, limit) {
      directMealToolCalls.mealSetSearchQueries.push(name)
      return (
        config.mealSetServiceOverrides?.searchByName?.(name, limit) ??
        okAsync([])
      )
    },
  }
  const server = createMcpServer({
    foodMasterService,
    mealHistoryService,
    mealLogService,
    mealLogNutritionReassignmentService,
    mealSkipService,
    stockService: createStubMcpDeps().stockService,
    profileService,
    foodSearchService,
    mealSetService,
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
  it('exposes the twenty-seven public tools with stable names', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const names = result.tools.map((t) => t.name).sort()
      expect(names).toEqual([
        'add_food_nutrition_version',
        'cancel_meal_skip',
        'count_stock',
        'delete_meal_log',
        'fill_food_nutrition',
        'get_profile',
        'get_recommendation_context',
        'get_stock_status',
        'list_deliveries',
        'list_food_nutrition_versions',
        'merge_food_master',
        'query_meals',
        'reassign_meal_log_nutrition',
        'receive_delivery',
        'record_meal_log',
        'record_meal_skip',
        'register_delivery',
        'register_food',
        'register_food_from_composition',
        'register_food_without_nutrition',
        'register_meal_set',
        'search_foods',
        'set_stock_item',
        'update_delivery_source_ref',
        'update_meal_log',
        'update_profile',
        'update_stock_lot',
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

  it('explains how correction metadata handles omitted and unknown values', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'add_food_nutrition_version',
      )
      expect(tool?.description).toEqual(
        '同じ food_master_id に栄養バージョンを追加する。change_kind=product_update は商品情報の更新に使い、checked_on を指定する。effective_from は実際の適用開始日が分かる場合だけ指定し、不明なら null を指定する。checked_on は情報を確認した日で、商品変更日を意味しない。change_kind=correction は誤登録の訂正に使い、corrects_version_id と reason を必ず指定する。訂正元が現行なら新バージョンが現行になり、過去バージョンなら現行は変わらない。訂正時に serving_basis、net_content、effective_from を省略すると訂正元の値を引き継ぎ、値を指定すると置き換える。これらを不明にする場合は null を指定する。栄養値は meal_logs.quantity が掛ける食品 1 つ分の値を指定する。出典の基準量が食品 1 つ分と異なる場合は食品 1 つ分へ換算する。source=web_search は is_estimated=false と source_url を指定する。source=composition_table_estimate は is_estimated=true と source_composition_code を指定する。source=user_input はユーザー本人が伝えた値に限り、source_url と source_composition_code は指定しない。source=model_estimate は is_estimated=true とし、出典 URL と composition code は指定しない。serving_basis と net_content は分かる値を記録する。既存の食事ログの数量、食品 ID、栄養バージョンは変更しない。',
      )
    } finally {
      await h.close()
    }
  })

  it('requires a preview and a reason before changing a meal log version', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'reassign_meal_log_nutrition',
      )
      expect(tool?.description).toEqual(
        'query_meals で確認した meal_log_id を指定し、選んだ食事ログの栄養バージョンを同じ食品の別バージョンへ差し替える。最初は dry_run=true で実行し、ログごとの前後の栄養値と影響日の合計を確認する。適用するときは dry_run=false とし、プレビューで返した各ログの before_nutrition_version.id を expected_from_versions に渡す。栄養バージョンが未割当だったログは nutrition_version_id=null を渡す。1 件でもプレビュー後にバージョンが変わっていた場合は全件を拒否する。reason は変更記録に保存される。数量、食品 ID、ログ件数は変更しない。',
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
        '未登録の食品を登録し、food_master_id と名前を返す。nutrition.energy_kcal は必須。公式情報はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。name はブランド名を先頭に付け、残りは公式の商品名をそのまま書く。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。公式情報もユーザーが伝えた値もない場合は、一般的な材料と量から栄養値を推定してよい。推定値は source=model_estimate と is_estimated=true を指定し、source_url と source_composition_code は指定しない。登録前にユーザーの確認を取らず、登録後に推定値であることを伝える。妥当な推定ができない場合は register_food_without_nutrition を使う。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。食品成分表に載っている自炊の素材は成分表から登録する。似た名前の候補が返されたら、同じ食品なら既存候補を使う。食品名や類似候補の同一性が不確かな場合はユーザーに確認する。候補すべてと別物だと確認できた場合のみ、confirmed_distinct_from_master_ids に候補の food_master_id をすべて指定して再送する。',
      )
    } finally {
      await h.close()
    }
  })

  it('explains the evidence rules for filling unknown nutrition', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const fillFoodNutrition = result.tools.find(
        (tool) => tool.name === 'fill_food_nutrition',
      )
      expect(fillFoodNutrition?.description).toEqual(
        '栄養値が未登録の food_master に栄養値を補完する。food_master_id を指定する。nutrition.energy_kcal は必須。補完のたびに新しい栄養バージョンを作り、既存バージョンの値は保持する。source=model_estimate の栄養値は source=web_search または source=user_input の値で補完でき、推定値を参照する過去ログはそのまま保持する。栄養バージョンが未割当の過去ログだけ新バージョンへ割り当て、応答に対象ログと影響日の合計前後を含める。その他の source がある食品と、source=model_estimate の値を別の推定値で置き換えることはできない。公式情報はメーカーまたは店の公式ページを優先し、まとめサイトやブログは使わない。source_url はこの商品とサイズの栄養値を載せたページにする。source=web_search は is_estimated=false かつ source_url 必須。source=user_input はユーザー本人が値を伝えた場合だけ使い、source_url は指定しない。公式情報もユーザーが伝えた値もない場合は一般的な材料と量から推定してよい。推定値は source=model_estimate と is_estimated=true を指定し、source_url と source_composition_code は指定しない。登録前にユーザーの確認を取らず、登録後に推定値であることを伝える。栄養値は出典が示す 1 つ分 (1 個、1 食、100g など) のまま渡す。',
      )
    } finally {
      await h.close()
    }
  })

  it('explains when to register a food without nutrition and that values can be added later', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'register_food_without_nutrition',
      )
      expect(tool?.description).toEqual(
        '栄養値が不明な食品を登録し、food_master_id と名前を返す。公式情報もユーザーが伝えた値もなく、一般的な材料と量から妥当な推定もできない場合だけ使う。推定できる場合は register_food を使い、登録前にユーザーの確認を取らず、登録後に推定値であることを伝える。栄養値は後から公式情報、ユーザーが伝えた値、またはモデルの推定で補完できる。似た名前の候補が返されたら、同じ食品なら既存候補を使う。食品名や類似候補の同一性が不確かな場合はユーザーに確認する。候補すべてと別物だと確認できた場合のみ、confirmed_distinct_from_master_ids に候補の food_master_id をすべて指定して再送する。',
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
          oneOf?: ReadonlyArray<{ properties?: Record<string, unknown> }>
        }
        propsByTool[tool.name] = [
          ...new Set([
            ...Object.keys(schema.properties ?? {}),
            ...(schema.oneOf ?? []).flatMap((variant) =>
              Object.keys(variant.properties ?? {}),
            ),
          ]),
        ].sort()
      }
      expect(propsByTool).toEqual({
        add_food_nutrition_version: [
          'change_kind',
          'checked_on',
          'corrects_version_id',
          'effective_from',
          'food_master_id',
          'is_estimated',
          'net_content',
          'nutrition',
          'reason',
          'serving_basis',
          'source',
          'source_composition_code',
          'source_url',
        ],
        cancel_meal_skip: ['date', 'meal_type'],
        count_stock: [
          'best_before',
          'food_master_id',
          'quantity',
          'received_date',
        ],
        delete_meal_log: ['meal_log_ids'],
        fill_food_nutrition: [
          'food_master_id',
          'is_estimated',
          'nutrition',
          'source',
          'source_url',
        ],
        get_profile: [],
        get_recommendation_context: ['period_from', 'period_to'],
        get_stock_status: [],
        list_deliveries: ['delivery_id', 'limit', 'source_ref', 'status'],
        list_food_nutrition_versions: ['food_master_id'],
        merge_food_master: [
          'dry_run',
          'loser_food_master_id',
          'survivor_food_master_id',
        ],
        query_meals: ['period_from', 'period_to'],
        reassign_meal_log_nutrition: [
          'dry_run',
          'expected_from_versions',
          'meal_log_ids',
          'reason',
          'to_nutrition_version_id',
        ],
        receive_delivery: ['delivery_id', 'items', 'received_date'],
        record_meal_log: ['date', 'items', 'meal_type'],
        record_meal_skip: ['date', 'meal_type'],
        register_delivery: [
          'change_deadline',
          'expected_date',
          'items',
          'source_ref',
          'status',
        ],
        register_meal_set: ['items', 'name'],
        register_food_from_composition: ['aliases', 'composition_code', 'name'],
        search_foods: ['limit', 'origin', 'queries'],
        set_stock_item: [
          'eat_within_days',
          'food_master_id',
          'storage_location_capacity',
          'storage_location_name',
        ],
        update_stock_lot: ['best_before', 'eat_by', 'stock_lot_id'],
        update_delivery_source_ref: ['delivery_id', 'source_ref'],
        register_food: [
          'aliases',
          'confirmed_distinct_from_master_ids',
          'is_estimated',
          'name',
          'nutrition',
          'source',
          'source_url',
        ],
        register_food_without_nutrition: [
          'aliases',
          'confirmed_distinct_from_master_ids',
          'name',
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

  it('requires dates and delivery identity for delivery operations', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const requiredByTool = Object.fromEntries(
        result.tools
          .filter((tool) =>
            [
              'register_delivery',
              'receive_delivery',
              'update_delivery_source_ref',
            ].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.inputSchema.required]),
      )
      expect(requiredByTool).toEqual({
        receive_delivery: ['delivery_id', 'received_date'],
        register_delivery: ['status', 'expected_date', 'items'],
        update_delivery_source_ref: ['delivery_id', 'source_ref'],
      })
    } finally {
      await h.close()
    }
  })

  it('requires the stock lot ID for stock lot date updates', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'update_stock_lot',
      )

      expect(tool?.inputSchema.required).toEqual(['stock_lot_id'])
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

  it('requires a name and item list for meal-set registration', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const tool = result.tools.find(
        (candidate) => candidate.name === 'register_meal_set',
      )
      expect(tool?.inputSchema.required).toEqual(['name', 'items'])
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

  it('explains food and meal set search results', async () => {
    const h = await start()
    try {
      const result = await h.client.listTools()
      const descriptions = Object.fromEntries(
        result.tools
          .filter((tool) =>
            [
              'search_foods',
              'register_food_from_composition',
              'register_meal_set',
            ].includes(tool.name),
          )
          .map((tool) => [tool.name, tool.description]),
      )
      expect(descriptions).toEqual({
        search_foods:
          '登録済み食品を複数の名前候補から検索し、食品名、kcal、栄養状態 (nutrition_status: confirmed / estimated / unknown)、最後に食べた JST 日付 (last_eaten_date) とそのときの量 (last_quantity) を返す。栄養値が不明な食品の kcal は null。last_eaten_date がある候補と同じ食品なら新規登録せず、その food_master_id を使う。量の指定が無ければ last_quantity を使い、null ならユーザーに量を聞く。origin が homemade の場合のみ食品成分表の候補も返す。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。成分表候補の energy_kcal は 100g あたり。meal_sets に一致があれば items を record_meal_log に渡す。ユーザーが品目を指定した場合は該当 item だけ差し替える。meal_type は発話から決め、無ければユーザーに聞く。',
        register_food_from_composition:
          '食品成分表の composition_code から食品マスタを登録する。成分表候補は自炊の素材にだけ使い、買った商品や外食には使わない。栄養値は食品成分表から 100g あたりの値をコピーするため、入力では指定できない。',
        register_meal_set:
          'マイセットを登録する。name はセット名、items は food_master_id と quantity の組み合わせ。quantity は食品 1 つ分への倍率。',
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
        '同じ食品を指す 2 つの食品マスタを統合する。survivor_food_master_id に残す食品、loser_food_master_id に統合する食品を指定する。survivor は、より信頼できる情報が揃っている食品を選ぶ。survivor の現行栄養値を維持し、loser の全栄養バージョンを survivor の続き番号で現行ではない履歴として残す。loser の食事ログは元の栄養バージョンと割り当ての経緯を保ったまま survivor に移る。loser の別名も survivor に移り、loser の名前は同じ文字列の別名が既に存在しない場合に survivor の別名へ加わる。dry_run は既定で true で、変更せずに移動内容を返す。試し実行の結果をユーザーに見せて確認を得てから dry_run=false を指定する。実際に統合すると取り消せない。',
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
            moved_nutrition_versions: [
              { previous_version_no: 1, version_no: 2 },
            ],
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
            moved_nutrition_versions: [
              { previous_version_no: 1, version_no: 2 },
            ],
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
          incomplete_nutrients: ['energy_kcal'],
          per_day: [
            {
              date: '2026-06-12',
              totals: { energy_kcal: 1850 },
              incomplete_nutrients: ['energy_kcal'],
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
            stock_shortfall: null,
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

  it('returns a stock shortfall after updating a meal log', async () => {
    let captured: UpdateMealLogInput | undefined
    const h = await start({
      mealLogOverrides: {
        update: (input) => {
          captured = input
          return okAsync({
            ...initialMealLog,
            quantity: 3,
            stockShortfall: 1.25,
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'update_meal_log',
        arguments: { meal_log_id: initialMealLog.id, quantity: 3 },
      })

      expect(observation({ result, captured })).toEqual({
        result: {
          content: [{ type: 'text', text: '食事ログを更新しました。' }],
          structuredContent: {
            meal_log_id: initialMealLog.id,
            food_master_id: initialMealLog.foodMasterId,
            food_name: '試験用食品 A',
            eaten_date: initialMealLog.eatenDate,
            meal_type: initialMealLog.mealType,
            quantity: 3,
            stock_shortfall: 1.25,
            nutrition: initialMealLog.nutrition,
            is_estimated: initialMealLog.isEstimated,
          },
        },
        captured: { id: initialMealLog.id, quantity: 3 },
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
            incomplete_nutrients: ['energy_kcal', 'protein_g'],
            per_day: [
              {
                date: '2025-11-23',
                totals: { energy_kcal: 701, protein_g: 27 },
                incomplete_nutrients: ['energy_kcal', 'protein_g'],
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
            {
              type: 'text',
              text: '登録済み食品を 1 件、マイセットを 0 件取得しました。',
            },
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
                last_eaten_date: '2026-01-02',
                last_quantity: 1.5,
              },
            ],
            meal_sets: [],
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
          lastEatenDate: null,
          lastQuantity: null,
        },
      ]),
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: { queries: ['item_token_beta'] },
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '登録済み食品を 1 件、マイセットを 0 件取得しました。',
          },
        ],
        structuredContent: {
          foods: [
            {
              food_master_id: 'fm_catalog_beta',
              composition_code: null,
              name: 'item_token_beta',
              energy_kcal: null,
              is_estimated: true,
              nutrition_status: 'estimated',
              last_eaten_date: null,
              last_quantity: null,
            },
          ],
          meal_sets: [],
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
          lastEatenDate: null,
          lastQuantity: null,
        },
        {
          foodMasterId: null,
          compositionCode: 'fc_search_fixture_beta',
          name: 'search_fixture_beta',
          isEstimated: true,
          nutritionStatus: 'estimated',
          energyKcalPer100g: 88,
          lastEatenDate: null,
          lastQuantity: null,
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
          content: [
            {
              type: 'text',
              text: '食品候補を 2 件、マイセットを 0 件取得しました。',
            },
          ],
          structuredContent: {
            foods: [
              {
                food_master_id: 'fm_search_fixture_alpha',
                composition_code: null,
                name: 'search_fixture_alpha',
                energy_kcal: 42,
                is_estimated: false,
                nutrition_status: 'confirmed',
                last_eaten_date: null,
                last_quantity: null,
              },
              {
                food_master_id: null,
                composition_code: 'fc_search_fixture_beta',
                name: 'search_fixture_beta',
                energy_kcal: 88,
                is_estimated: true,
                nutrition_status: 'estimated',
                last_eaten_date: null,
                last_quantity: null,
              },
            ],
            meal_sets: [],
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
          lastEatenDate: null,
          lastQuantity: null,
        },
      ]),
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: { queries: ['unknown menu'] },
      })

      expect(result).toEqual({
        content: [
          {
            type: 'text',
            text: '登録済み食品を 1 件、マイセットを 0 件取得しました。',
          },
        ],
        structuredContent: {
          foods: [
            {
              food_master_id: 'fm_catalog_unknown',
              composition_code: null,
              name: 'unknown menu',
              energy_kcal: null,
              is_estimated: false,
              nutrition_status: 'unknown',
              last_eaten_date: null,
              last_quantity: null,
            },
          ],
          meal_sets: [],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('returns matching meal sets once across all search terms', async () => {
    const firstMealSet: MealSet = {
      id: 'ms_fixture_beta',
      name: 'Sample meal set beta',
      items: [
        {
          foodMasterId: 'fm_fixture_grain',
          foodName: 'Sample grain',
          quantity: 1,
          energyKcalPerUnit: null,
        },
        {
          foodMasterId: 'fm_fixture_side',
          foodName: 'Sample side',
          quantity: 1.5,
          energyKcalPerUnit: null,
        },
      ],
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    }
    const secondMealSet: MealSet = {
      id: 'ms_fixture_delta',
      name: 'Sample meal set delta',
      items: [
        {
          foodMasterId: 'fm_fixture_protein',
          foodName: 'Sample protein',
          quantity: 2,
          energyKcalPerUnit: null,
        },
      ],
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    }
    const h = await start({
      mealSetServiceOverrides: {
        searchByName: (query) => {
          if (query === 'sample meal set beta') return okAsync([firstMealSet])
          if (query === 'sample set alias beta') {
            return okAsync([firstMealSet, secondMealSet])
          }
          return okAsync([])
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: {
          queries: ['sample meal set beta', 'sample set alias beta'],
        },
      })

      expect(
        observation({
          result,
          mealSetSearchQueries: h.directMealToolCalls.mealSetSearchQueries,
        }),
      ).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: '登録済み食品を 1 件、マイセットを 2 件取得しました。',
            },
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
                last_eaten_date: '2026-01-02',
                last_quantity: 1.5,
              },
            ],
            meal_sets: [
              {
                meal_set_id: 'ms_fixture_beta',
                name: 'Sample meal set beta',
                items: [
                  {
                    food_master_id: 'fm_fixture_grain',
                    food_name: 'Sample grain',
                    quantity: 1,
                  },
                  {
                    food_master_id: 'fm_fixture_side',
                    food_name: 'Sample side',
                    quantity: 1.5,
                  },
                ],
              },
              {
                meal_set_id: 'ms_fixture_delta',
                name: 'Sample meal set delta',
                items: [
                  {
                    food_master_id: 'fm_fixture_protein',
                    food_name: 'Sample protein',
                    quantity: 2,
                  },
                ],
              },
            ],
          },
        },
        mealSetSearchQueries: ['sample meal set beta', 'sample set alias beta'],
      })
    } finally {
      await h.close()
    }
  })

  it('returns an error when meal-set search fails', async () => {
    const h = await start({
      mealSetServiceOverrides: {
        searchByName: () => errAsync(new MealSetPersistenceError('stub')),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'search_foods',
        arguments: { queries: ['item_token_alpha'] },
      })

      expect(result).toEqual({
        content: [{ type: 'text', text: 'stub' }],
        isError: true,
      })
    } finally {
      await h.close()
    }
  })
})

describe('register_meal_set', () => {
  it('registers meal-set items through MealSetService', async () => {
    const mealSet: MealSet = {
      id: 'ms_fixture_gamma',
      name: 'Sample meal set gamma',
      items: [
        {
          foodMasterId: 'fm_fixture_gamma',
          foodName: 'Sample food gamma',
          quantity: 1.25,
          energyKcalPerUnit: null,
        },
      ],
      createdAt: new Date('2026-04-17T00:00:00.000Z'),
    }
    const h = await start({
      mealSetServiceOverrides: {
        register: () => okAsync(mealSet),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_meal_set',
        arguments: {
          name: 'Sample meal set gamma',
          items: [{ food_master_id: 'fm_fixture_gamma', quantity: 1.25 }],
        },
      })

      expect(
        observation({
          result,
          registrations: h.directMealToolCalls.registerMealSets,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: 'マイセットを登録しました。' }],
          structuredContent: {
            meal_set_id: 'ms_fixture_gamma',
            name: 'Sample meal set gamma',
            items: [
              {
                food_master_id: 'fm_fixture_gamma',
                food_name: 'Sample food gamma',
                quantity: 1.25,
              },
            ],
          },
        },
        registrations: [
          {
            name: 'Sample meal set gamma',
            items: [{ foodMasterId: 'fm_fixture_gamma', quantity: 1.25 }],
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns the domain error for empty meal-set items', async () => {
    const error = new EmptyMealSetItemsError()
    const h = await start({
      mealSetServiceOverrides: {
        register: () => errAsync(error),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_meal_set',
        arguments: { name: 'Sample empty set', items: [] },
      })

      expect(
        observation({
          result,
          registrations: h.directMealToolCalls.registerMealSets,
        }),
      ).toEqual({
        result: {
          content: [{ type: 'text', text: 'items must not be empty' }],
          isError: true,
          structuredContent: {
            error: {
              code: 'meal_set/empty_items',
              message: 'items must not be empty',
            },
          },
        },
        registrations: [{ name: 'Sample empty set', items: [] }],
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

  it('passes model-estimated nutrition without evidence to FoodMasterService', async () => {
    const calls: Array<{ input: RegisterFoodMasterInput }> = []
    const h = await start({
      foodMasterOverrides: {
        registerWithSimilarNameCheck: (input) => {
          calls.push({ input })
          return okAsync({
            id: 'fm_estimated_alpha',
            name: input.name,
            aliases: input.aliases ?? [],
            isEstimated: input.isEstimated,
            nutritionStatus: 'estimated',
            source: input.source,
            sourceUrl: input.sourceUrl ?? null,
            sourceCompositionCode: null,
            nutrition: input.nutrition,
            createdAt: new Date('2026-04-17T00:00:00.000Z'),
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food',
        arguments: {
          name: 'Sample Street Market lunch box',
          nutrition: { energy_kcal: 460, protein_g: 18 },
          source: 'model_estimate',
          is_estimated: true,
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品を登録しました。' }],
          structuredContent: {
            food_master_id: 'fm_estimated_alpha',
            name: 'Sample Street Market lunch box',
          },
        },
        calls: [
          {
            input: {
              name: 'Sample Street Market lunch box',
              nutrition: { energy_kcal: 460, protein_g: 18 },
              source: 'model_estimate',
              isEstimated: true,
            },
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

describe('food nutrition versions', () => {
  it('adds and lists full nutrition version records through MCP', async () => {
    const previousVersion: FoodMasterNutritionVersion = {
      id: 'nutrition_version_alpha',
      foodMasterId: 'fm_version_alpha',
      versionNo: 1,
      changeKind: 'initial',
      correctsVersionId: null,
      isCurrent: false,
      servingBasis: null,
      netContent: null,
      nutrition: { energy_kcal: 120, protein_g: 4 },
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      isEstimated: false,
      checkedOn: null,
      effectiveFrom: null,
      reason: null,
      mealLogCount: 3,
    }
    const updatedVersion: FoodMasterNutritionVersion = {
      id: 'nutrition_version_beta',
      foodMasterId: 'fm_version_alpha',
      versionNo: 2,
      changeKind: 'product_update',
      correctsVersionId: null,
      isCurrent: true,
      servingBasis: '1 package (80 g)',
      netContent: '4 packages (320 g)',
      nutrition: { energy_kcal: 145, protein_g: 5 },
      source: 'web_search',
      sourceUrl: 'https://example.test/items/sample-cereal',
      sourceCompositionCode: null,
      isEstimated: false,
      checkedOn: '2026-07-12',
      effectiveFrom: '2026-07-01',
      reason: null,
      mealLogCount: 0,
    }
    const calls: {
      add: AddFoodMasterNutritionVersionInput[]
      list: string[]
    } = { add: [], list: [] }
    const h = await start({
      foodMasterOverrides: {
        addNutritionVersion(input) {
          calls.add.push(input)
          return okAsync(updatedVersion)
        },
        listNutritionVersions(foodMasterId) {
          calls.list.push(foodMasterId)
          return okAsync([previousVersion, updatedVersion])
        },
      },
    })
    try {
      const addResult = await h.client.callTool({
        name: 'add_food_nutrition_version',
        arguments: {
          food_master_id: 'fm_version_alpha',
          change_kind: 'product_update',
          nutrition: { energy_kcal: 145, protein_g: 5 },
          source: 'web_search',
          source_url: 'https://example.test/items/sample-cereal',
          is_estimated: false,
          serving_basis: '1 package (80 g)',
          net_content: '4 packages (320 g)',
          checked_on: '2026-07-12',
          effective_from: '2026-07-01',
        },
      })
      const listResult = await h.client.callTool({
        name: 'list_food_nutrition_versions',
        arguments: { food_master_id: 'fm_version_alpha' },
      })

      expect(observation({ addResult, listResult, calls })).toEqual({
        addResult: {
          content: [{ type: 'text', text: '栄養バージョンを追加しました。' }],
          structuredContent: {
            nutrition_version_id: 'nutrition_version_beta',
            food_master_id: 'fm_version_alpha',
            version_no: 2,
            change_kind: 'product_update',
            corrects_version_id: null,
            is_current: true,
            serving_basis: '1 package (80 g)',
            net_content: '4 packages (320 g)',
            nutrition: { energy_kcal: 145, protein_g: 5 },
            source: 'web_search',
            source_url: 'https://example.test/items/sample-cereal',
            source_composition_code: null,
            is_estimated: false,
            checked_on: '2026-07-12',
            effective_from: '2026-07-01',
            reason: null,
            meal_log_count: 0,
          },
        },
        listResult: {
          content: [
            { type: 'text', text: '2 件の栄養バージョンを取得しました。' },
          ],
          structuredContent: {
            food_master_id: 'fm_version_alpha',
            nutrition_versions: [
              {
                nutrition_version_id: 'nutrition_version_alpha',
                food_master_id: 'fm_version_alpha',
                version_no: 1,
                change_kind: 'initial',
                corrects_version_id: null,
                is_current: false,
                serving_basis: null,
                net_content: null,
                nutrition: { energy_kcal: 120, protein_g: 4 },
                source: 'user_input',
                source_url: null,
                source_composition_code: null,
                is_estimated: false,
                checked_on: null,
                effective_from: null,
                reason: null,
                meal_log_count: 3,
              },
              {
                nutrition_version_id: 'nutrition_version_beta',
                food_master_id: 'fm_version_alpha',
                version_no: 2,
                change_kind: 'product_update',
                corrects_version_id: null,
                is_current: true,
                serving_basis: '1 package (80 g)',
                net_content: '4 packages (320 g)',
                nutrition: { energy_kcal: 145, protein_g: 5 },
                source: 'web_search',
                source_url: 'https://example.test/items/sample-cereal',
                source_composition_code: null,
                is_estimated: false,
                checked_on: '2026-07-12',
                effective_from: '2026-07-01',
                reason: null,
                meal_log_count: 0,
              },
            ],
          },
        },
        calls: {
          add: [
            {
              foodMasterId: 'fm_version_alpha',
              changeKind: 'product_update',
              nutrition: { energy_kcal: 145, protein_g: 5 },
              source: 'web_search',
              isEstimated: false,
              sourceUrl: 'https://example.test/items/sample-cereal',
              servingBasis: '1 package (80 g)',
              netContent: '4 packages (320 g)',
              checkedOn: '2026-07-12',
              effectiveFrom: '2026-07-01',
            },
          ],
          list: ['fm_version_alpha'],
        },
      })
    } finally {
      await h.close()
    }
  })

  it('allows explicit null correction metadata through MCP', async () => {
    const correctionVersion: FoodMasterNutritionVersion = {
      id: 'nutrition_version_cleared',
      foodMasterId: 'fm_version_cleared',
      versionNo: 2,
      changeKind: 'correction',
      correctsVersionId: '11111111-1111-4111-8111-111111111111',
      isCurrent: true,
      servingBasis: null,
      netContent: null,
      nutrition: { energy_kcal: 105 },
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      isEstimated: false,
      checkedOn: null,
      effectiveFrom: null,
      reason: 'synthetic correction reason',
      mealLogCount: 0,
    }
    const calls: AddFoodMasterNutritionVersionInput[] = []
    const h = await start({
      foodMasterOverrides: {
        addNutritionVersion(input) {
          calls.push(input)
          return okAsync(correctionVersion)
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'add_food_nutrition_version',
        arguments: {
          food_master_id: 'fm_version_cleared',
          change_kind: 'correction',
          corrects_version_id: '11111111-1111-4111-8111-111111111111',
          reason: 'synthetic correction reason',
          nutrition: { energy_kcal: 105 },
          source: 'user_input',
          is_estimated: false,
          serving_basis: null,
          net_content: null,
          effective_from: null,
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '栄養バージョンを追加しました。' }],
          structuredContent: {
            nutrition_version_id: 'nutrition_version_cleared',
            food_master_id: 'fm_version_cleared',
            version_no: 2,
            change_kind: 'correction',
            corrects_version_id: '11111111-1111-4111-8111-111111111111',
            is_current: true,
            serving_basis: null,
            net_content: null,
            nutrition: { energy_kcal: 105 },
            source: 'user_input',
            source_url: null,
            source_composition_code: null,
            is_estimated: false,
            checked_on: null,
            effective_from: null,
            reason: 'synthetic correction reason',
            meal_log_count: 0,
          },
        },
        calls: [
          {
            foodMasterId: 'fm_version_cleared',
            changeKind: 'correction',
            correctsVersionId: '11111111-1111-4111-8111-111111111111',
            reason: 'synthetic correction reason',
            nutrition: { energy_kcal: 105 },
            source: 'user_input',
            isEstimated: false,
            servingBasis: null,
            netContent: null,
            effectiveFrom: null,
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('rejects incomplete nutrition version changes before calling the service', async () => {
    const calls: AddFoodMasterNutritionVersionInput[] = []
    const h = await start({
      foodMasterOverrides: {
        addNutritionVersion(input) {
          calls.push(input)
          return errAsync(
            new FoodMasterDomainError('persistence_failed', 'should not run'),
          )
        },
      },
    })
    const invalidArguments: ReadonlyArray<Record<string, unknown>> = [
      {
        food_master_id: 'fm_version_validation',
        change_kind: 'correction',
        corrects_version_id: '11111111-1111-4111-8111-111111111111',
        nutrition: { energy_kcal: 100 },
        source: 'user_input',
        is_estimated: false,
      },
      {
        food_master_id: 'fm_version_validation',
        change_kind: 'correction',
        reason: 'synthetic correction reason',
        nutrition: { energy_kcal: 100 },
        source: 'user_input',
        is_estimated: false,
      },
      {
        food_master_id: 'fm_version_validation',
        change_kind: 'product_update',
        nutrition: { energy_kcal: 100 },
        source: 'user_input',
        is_estimated: false,
      },
    ]
    try {
      const results = await Promise.all(
        invalidArguments.map((args) =>
          h.client.callTool({
            name: 'add_food_nutrition_version',
            arguments: args,
          }),
        ),
      )

      expect(
        observation({
          results: results.map(normalizeValidationError),
          calls,
        }),
      ).toEqual({
        results: [
          {
            content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
            isError: true,
          },
          {
            content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
            isError: true,
          },
          {
            content: [{ type: 'text', text: VALIDATION_ERROR_TEXT }],
            isError: true,
          },
        ],
        calls: [],
      })
    } finally {
      await h.close()
    }
  })
})

describe('reassign_meal_log_nutrition', () => {
  const preview: MealLogNutritionReassignmentResult = {
    applied: false,
    reason: 'Corrected registered values',
    mealLogs: [
      {
        id: 'mcp_fixture_meal_reassign',
        foodMasterId: 'mcp_fixture_food_reassign',
        eatenDate: jstDate('2026-04-17'),
        mealType: 'lunch',
        quantity: 1.5,
        from: {
          id: '00000000-0000-7000-8000-000000000001',
          versionNo: 1,
          nutrition: { energy_kcal: 100, protein_g: 5 },
        },
        to: {
          id: '00000000-0000-7000-8000-000000000002',
          versionNo: 2,
          nutrition: { energy_kcal: 180, protein_g: 8 },
        },
      },
    ],
    affectedDayTotals: [
      {
        date: jstDate('2026-04-17'),
        totalsBefore: { energy_kcal: 150, protein_g: 7.5 },
        totalsAfter: { energy_kcal: 270, protein_g: 12 },
      },
    ],
  }

  it('previews the previous and replacement values by default', async () => {
    const calls: MealLogNutritionReassignmentInput[] = []
    const h = await start({
      mealLogNutritionReassignmentService: {
        reassign(input) {
          calls.push(input)
          return okAsync(preview)
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'reassign_meal_log_nutrition',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_reassign'],
          to_nutrition_version_id: '00000000-0000-7000-8000-000000000002',
          reason: 'Corrected registered values',
        },
      })
      expect(observation({ result, calls, logs: h.logs })).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: '栄養バージョンの差し替え内容をプレビューしました。',
            },
          ],
          structuredContent: {
            dry_run: true,
            reason: 'Corrected registered values',
            meal_logs: [
              {
                meal_log_id: 'mcp_fixture_meal_reassign',
                food_master_id: 'mcp_fixture_food_reassign',
                eaten_date: '2026-04-17',
                meal_type: 'lunch',
                quantity: 1.5,
                before_nutrition_version: {
                  id: '00000000-0000-7000-8000-000000000001',
                  version_no: 1,
                  nutrition: { energy_kcal: 100, protein_g: 5 },
                },
                after_nutrition_version: {
                  id: '00000000-0000-7000-8000-000000000002',
                  version_no: 2,
                  nutrition: { energy_kcal: 180, protein_g: 8 },
                },
              },
            ],
            affected_day_totals: [
              {
                date: '2026-04-17',
                totals_before: { energy_kcal: 150, protein_g: 7.5 },
                totals_after: { energy_kcal: 270, protein_g: 12 },
              },
            ],
          },
        },
        calls: [
          {
            mealLogIds: ['mcp_fixture_meal_reassign'],
            toNutritionVersionId: '00000000-0000-7000-8000-000000000002',
            reason: 'Corrected registered values',
            apply: false,
          },
        ],
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'reassign_meal_log_nutrition' },
          },
          {
            event: 'meshi.tool_succeeded',
            payload: {
              tool: 'reassign_meal_log_nutrition',
              dry_run: true,
              meal_log_count: 1,
            },
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('requires the previewed old version for an applied reassignment', async () => {
    const calls: MealLogNutritionReassignmentInput[] = []
    const h = await start({
      mealLogNutritionReassignmentService: {
        reassign(input) {
          calls.push(input)
          return okAsync({ ...preview, applied: input.apply })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'reassign_meal_log_nutrition',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_reassign'],
          to_nutrition_version_id: '00000000-0000-7000-8000-000000000002',
          reason: 'Corrected registered values',
          dry_run: false,
          expected_from_versions: [
            {
              meal_log_id: 'mcp_fixture_meal_reassign',
              nutrition_version_id: '00000000-0000-7000-8000-000000000001',
            },
          ],
        },
      })
      expect(observation({ result, calls })).toEqual({
        result: {
          content: [
            {
              type: 'text',
              text: '食事ログの栄養バージョンを差し替えました。',
            },
          ],
          structuredContent: {
            dry_run: false,
            reason: 'Corrected registered values',
            meal_logs: [
              {
                meal_log_id: 'mcp_fixture_meal_reassign',
                food_master_id: 'mcp_fixture_food_reassign',
                eaten_date: '2026-04-17',
                meal_type: 'lunch',
                quantity: 1.5,
                before_nutrition_version: {
                  id: '00000000-0000-7000-8000-000000000001',
                  version_no: 1,
                  nutrition: { energy_kcal: 100, protein_g: 5 },
                },
                after_nutrition_version: {
                  id: '00000000-0000-7000-8000-000000000002',
                  version_no: 2,
                  nutrition: { energy_kcal: 180, protein_g: 8 },
                },
              },
            ],
            affected_day_totals: [
              {
                date: '2026-04-17',
                totals_before: { energy_kcal: 150, protein_g: 7.5 },
                totals_after: { energy_kcal: 270, protein_g: 12 },
              },
            ],
          },
        },
        calls: [
          {
            mealLogIds: ['mcp_fixture_meal_reassign'],
            toNutritionVersionId: '00000000-0000-7000-8000-000000000002',
            reason: 'Corrected registered values',
            apply: true,
            expectedFromVersions: [
              {
                mealLogId: 'mcp_fixture_meal_reassign',
                nutritionVersionId: '00000000-0000-7000-8000-000000000001',
              },
            ],
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns a structured conflict when a reviewed version changed', async () => {
    const message =
      'meal_log nutrition version changed since preview: mcp_fixture_meal_reassign'
    const h = await start({
      mealLogNutritionReassignmentService: {
        reassign: () =>
          errAsync(
            new DomainError(message, 'meal_log/nutrition_version_changed'),
          ),
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'reassign_meal_log_nutrition',
        arguments: {
          meal_log_ids: ['mcp_fixture_meal_reassign'],
          to_nutrition_version_id: '00000000-0000-7000-8000-000000000002',
          reason: 'Corrected registered values',
          dry_run: false,
          expected_from_versions: [
            {
              meal_log_id: 'mcp_fixture_meal_reassign',
              nutrition_version_id: '00000000-0000-7000-8000-000000000001',
            },
          ],
        },
      })
      expect(observation({ result, logs: h.logs })).toEqual({
        result: {
          content: [{ type: 'text', text: message }],
          isError: true,
          structuredContent: {
            error: {
              code: 'meal_log/nutrition_version_changed',
              message,
            },
          },
        },
        logs: [
          {
            event: 'meshi.tool_called',
            payload: { tool: 'reassign_meal_log_nutrition' },
          },
          {
            event: 'meshi.tool_failed',
            payload: {
              tool: 'reassign_meal_log_nutrition',
              code: 'meal_log/nutrition_version_changed',
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

describe('fill_food_nutrition', () => {
  it('fills an unknown food through FoodMasterService', async () => {
    const calls: FillFoodNutritionInput[] = []
    const h = await start({
      foodMasterOverrides: {
        fillNutrition: (input) => {
          calls.push(input)
          return okAsync({
            nutritionStatus: 'confirmed',
            nutritionVersionNo: 1,
            assignedMealLogs: [
              {
                id: 'ml_unknown_alpha',
                eatenDate: jstDate('2026-06-01'),
                mealType: 'lunch',
                quantity: 1.5,
              },
            ],
            affectedDayTotals: [
              {
                date: jstDate('2026-06-01'),
                totalsBefore: {},
                totalsAfter: { energy_kcal: 472.5 },
              },
            ],
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'fill_food_nutrition',
        arguments: {
          food_master_id: 'fm_unknown_alpha',
          nutrition: { energy_kcal: 315, protein_g: 12.5 },
          source: 'web_search',
          is_estimated: false,
          source_url: 'https://example.test/items/sample-bowl',
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品の栄養値を補完しました。' }],
          structuredContent: {
            food_master_id: 'fm_unknown_alpha',
            nutrition_status: 'confirmed',
            nutrition_version_no: 1,
            assigned_meal_logs: [
              {
                meal_log_id: 'ml_unknown_alpha',
                eaten_date: '2026-06-01',
                meal_type: 'lunch',
                quantity: 1.5,
              },
            ],
            affected_day_totals: [
              {
                date: '2026-06-01',
                totals_before: {},
                totals_after: { energy_kcal: 472.5 },
              },
            ],
          },
        },
        calls: [
          {
            foodMasterId: 'fm_unknown_alpha',
            nutrition: { energy_kcal: 315, protein_g: 12.5 },
            source: 'web_search',
            isEstimated: false,
            sourceUrl: 'https://example.test/items/sample-bowl',
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('passes model-estimated nutrition to FoodMasterService', async () => {
    const calls: FillFoodNutritionInput[] = []
    const h = await start({
      foodMasterOverrides: {
        fillNutrition: (input) => {
          calls.push(input)
          return okAsync({
            nutritionStatus: 'estimated',
            nutritionVersionNo: 1,
            assignedMealLogs: [],
            affectedDayTotals: [],
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'fill_food_nutrition',
        arguments: {
          food_master_id: 'fm_unknown_alpha',
          nutrition: { energy_kcal: 275, protein_g: 11 },
          source: 'model_estimate',
          is_estimated: true,
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品の栄養値を補完しました。' }],
          structuredContent: {
            food_master_id: 'fm_unknown_alpha',
            nutrition_status: 'estimated',
            nutrition_version_no: 1,
            assigned_meal_logs: [],
            affected_day_totals: [],
          },
        },
        calls: [
          {
            foodMasterId: 'fm_unknown_alpha',
            nutrition: { energy_kcal: 275, protein_g: 11 },
            source: 'model_estimate',
            isEstimated: true,
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('requires energy_kcal before calling FoodMasterService', async () => {
    const calls: FillFoodNutritionInput[] = []
    const h = await start({
      foodMasterOverrides: {
        fillNutrition: (input) => {
          calls.push(input)
          return okAsync({
            nutritionStatus: 'confirmed',
            nutritionVersionNo: 1,
            assignedMealLogs: [],
            affectedDayTotals: [],
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'fill_food_nutrition',
        arguments: {
          food_master_id: 'fm_unknown_alpha',
          nutrition: { protein_g: 12.5 },
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
})

describe('register_food_without_nutrition', () => {
  it('registers a food without nutrition and forwards aliases and confirmations', async () => {
    const calls: Array<{
      input: RegisterFoodMasterWithoutNutritionInput
      confirmedDistinctFromMasterIds?: ReadonlyArray<string>
    }> = []
    const h = await start({
      foodMasterOverrides: {
        registerWithoutNutritionWithSimilarNameCheck: (
          input,
          confirmedDistinctFromMasterIds,
        ) => {
          calls.push({
            input,
            ...(confirmedDistinctFromMasterIds === undefined
              ? {}
              : { confirmedDistinctFromMasterIds }),
          })
          return okAsync({
            id: 'fm_unknown_alpha',
            name: input.name,
            aliases: input.aliases ?? [],
            isEstimated: false,
            nutritionStatus: 'unknown',
            source: null,
            sourceUrl: null,
            sourceCompositionCode: null,
            nutrition: {},
            createdAt: new Date('2026-04-17T00:00:00.000Z'),
          })
        },
      },
    })
    try {
      const result = await h.client.callTool({
        name: 'register_food_without_nutrition',
        arguments: {
          name: 'Example Bistro lunch plate',
          aliases: ['Example Bistro plate'],
          confirmed_distinct_from_master_ids: ['fm_candidate_alpha'],
        },
      })

      expect(observation({ result, calls })).toEqual({
        result: {
          content: [{ type: 'text', text: '食品を登録しました。' }],
          structuredContent: {
            food_master_id: 'fm_unknown_alpha',
            name: 'Example Bistro lunch plate',
          },
        },
        calls: [
          {
            input: {
              name: 'Example Bistro lunch plate',
              aliases: ['Example Bistro plate'],
            },
            confirmedDistinctFromMasterIds: ['fm_candidate_alpha'],
          },
        ],
      })
    } finally {
      await h.close()
    }
  })

  it('returns similar-name candidates in the structured error', async () => {
    const calls: Array<{
      input: RegisterFoodMasterWithoutNutritionInput
      confirmedDistinctFromMasterIds?: ReadonlyArray<string>
    }> = []
    const message =
      'existing food_master(s) with a similar name were found; reuse one of them if it is the same product, gather stronger evidence and retry if unsure, ask the user to disambiguate, or retry with confirmed_distinct_from_master_ids listing exactly these food_master_id values once you have verified this is a different product'
    const h = await start({
      foodMasterOverrides: {
        registerWithoutNutritionWithSimilarNameCheck: (
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
                  name: 'Example Bistro dinner plate',
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
        name: 'register_food_without_nutrition',
        arguments: { name: 'Example Bistro lunch plate' },
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
                  name: 'Example Bistro dinner plate',
                  score: 0.73,
                },
              ],
            },
          },
        },
        calls: [
          {
            input: { name: 'Example Bistro lunch plate' },
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
    const h = await start({
      recordMealLogResults: recordedMealLogItems.map((item) => ({
        ...item,
        stockShortfall: 0.5,
      })),
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
                stock_shortfall: 0.5,
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
              stock_shortfall: null,
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
