import { describe, expect, it } from 'vitest'

import type { WebSearchClient } from '@/adapters/web-search/web-search-client'
import type { FoodMasterService } from '@/domain/food-master/service'
import type { FoodMatcher } from '@/domain/food-matcher/food-matcher'
import type { MealHistoryService } from '@/domain/meal-history/types'
import type { MealLogService } from '@/domain/meal-log/meal-log-service'
import type { UserProfileService } from '@/domain/user-profile/user-profile-service'
import {
  createDomainToolsRegistry,
  type DomainToolsDeps,
} from '@/llm/domain-tools/registry'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

// Mirror normalizeResult's masking on the JSON-parsed envelope.
const normalizeEnvelope = (raw: unknown): unknown => {
  if (!isRecord(raw) || !isRecord(raw['error'])) return raw
  const error = raw['error']
  const details = error['details']
  let normalizedDetails: unknown = details
  if (isRecord(details) && Array.isArray(details['issues'])) {
    normalizedDetails = {
      ...details,
      issues: { count: details['issues'].length },
    }
  }
  return {
    error: {
      code: error['code'],
      message: '<dynamic>',
      ...(normalizedDetails === undefined
        ? {}
        : { details: normalizedDetails }),
    },
  }
}

const stubDeps = (override: Partial<DomainToolsDeps> = {}): DomainToolsDeps => {
  const mealLogService: MealLogService = {
    record: () =>
      Promise.reject(new Error('mealLogService.record not stubbed')),
    getById: () => Promise.resolve(null),
  }
  const foodMasterService: FoodMasterService = {
    register: () =>
      Promise.reject(new Error('foodMasterService.register not stubbed')),
    getById: () => Promise.resolve(null),
  }
  const foodMatcher: FoodMatcher = {
    search: () => Promise.resolve([]),
  }
  const mealHistoryService: MealHistoryService = {
    query: () =>
      Promise.resolve({
        totals: {},
        perDay: [],
        entries: [],
        hasEstimatedValues: false,
      }),
  }
  const userProfileService: UserProfileService = {
    get: () =>
      Promise.resolve({
        likes: [],
        dislikes: [],
        allergies: [],
        constraints: [],
      }),
    update: () =>
      Promise.resolve({
        likes: [],
        dislikes: [],
        allergies: [],
        constraints: [],
      }),
  }
  const webSearchClient: WebSearchClient = {
    search: () => Promise.resolve({ snippets: [] }),
  }
  return {
    mealLogService,
    foodMasterService,
    foodMatcher,
    mealHistoryService,
    userProfileService,
    webSearchClient,
    ...override,
  }
}

describe('createDomainToolsRegistry', () => {
  it('registers all seven internal tools and exposes them via toLlmSchemas in the same order', () => {
    const registry = createDomainToolsRegistry(stubDeps())

    const expectedNames = [
      'record_meal_log',
      'search_food_master',
      'register_food_master',
      'query_meal_history',
      'get_user_profile',
      'update_user_profile',
      'web_search',
    ]

    expect({
      list: registry.list().map((t) => t.name),
      schemas: registry.toLlmSchemas().map((s) => s.name),
    }).toEqual({ list: expectedNames, schemas: expectedNames })
  })

  it('executeToolUse returns the JSON-encoded successful result on a known tool', async () => {
    const registry = createDomainToolsRegistry(
      stubDeps({
        foodMatcher: {
          search: () =>
            Promise.resolve([
              {
                reason: 'history_recent',
                score: 0.9,
                foodMasterId: 'fm_rice',
                compositionCode: null,
                name: '白米',
                isEstimated: false,
              },
            ]),
        },
      }),
    )

    const result = await registry.executeToolUse({
      id: 'call_1',
      name: 'search_food_master',
      input: { query: '白米', limit: 1 },
    })

    expect(result).toEqual({
      content: JSON.stringify({
        candidates: [
          {
            food_master_id: 'fm_rice',
            composition_code: null,
            name: '白米',
            is_estimated: false,
            score: 0.9,
            reason: 'history_recent',
          },
        ],
      }),
    })
  })

  it('executeToolUse encodes ToolError as {error} and sets isError=true on tool failure', async () => {
    const registry = createDomainToolsRegistry(stubDeps())

    const result = await registry.executeToolUse({
      id: 'call_2',
      name: 'search_food_master',
      input: { query: '' },
    })
    const parsed: unknown = JSON.parse(result.content)

    expect({
      isError: result.isError,
      parsed: normalizeEnvelope(parsed),
    }).toEqual({
      isError: true,
      parsed: {
        error: {
          code: 'invalid_input',
          message: '<dynamic>',
          details: { issues: { count: 1 } },
        },
      },
    })
  })

  it('executeToolUse returns unknown_tool error for an unregistered name', async () => {
    const registry = createDomainToolsRegistry(stubDeps())

    const result = await registry.executeToolUse({
      id: 'call_3',
      name: 'does_not_exist',
      input: {},
    })

    expect(result).toEqual({
      content: JSON.stringify({
        error: {
          code: 'unknown_tool',
          message: 'unknown tool: does_not_exist',
        },
      }),
      isError: true,
    })
  })
})
