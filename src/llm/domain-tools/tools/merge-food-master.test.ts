import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type { MergeFoodMasterResult } from '#domain/food-master/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createMergeFoodMasterTool } from '#llm/domain-tools/tools/merge-food-master'

type MergeCall = {
  readonly survivorId: string
  readonly loserId: string
  readonly dryRun: boolean
}

const mergeResult: MergeFoodMasterResult = {
  survivorId: 'fm_survivor',
  loserId: 'fm_loser',
  applied: false,
  movedAliases: ['もち米'],
  nameMovedAsAlias: 'ロースハム',
  movedUnits: [{ unit: '枚', gramsPerUnit: 20 }],
  discardedUnits: [{ unit: '個', gramsPerUnit: 55 }],
  discardedNutrition: { energy_kcal: 118 },
  movedMealLogCount: 3,
}

const setup = (
  override: Partial<FoodMasterService> = {},
): {
  tool: ReturnType<typeof createMergeFoodMasterTool>
  calls: MergeCall[]
} => {
  const notStubbed = (method: string) =>
    errAsync(
      new FoodMasterDomainError(
        'persistence_failed',
        `foodMasterService.${method} not stubbed`,
      ),
    )
  const calls: MergeCall[] = []
  const service: FoodMasterService = {
    register: () => notStubbed('register'),
    getById: () => notStubbed('getById'),
    findSimilarNames: () => notStubbed('findSimilarNames'),
    addAlias: () => notStubbed('addAlias'),
    registerFromComposition: () => notStubbed('registerFromComposition'),
    merge: (survivorId, loserId, dryRun) => {
      calls.push({ survivorId, loserId, dryRun })
      return okAsync(mergeResult)
    },
    ...override,
  }
  return { tool: createMergeFoodMasterTool(service), calls }
}

describe('merge_food_master tool', () => {
  it('exposes survivor/loser ids as required and dry_run as an optional boolean defaulting to true', () => {
    const { tool } = setup()

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        survivor_food_master_id: { type: 'string', minLength: 1 },
        loser_food_master_id: { type: 'string', minLength: 1 },
        dry_run: { type: 'boolean', default: true },
      },
      required: ['survivor_food_master_id', 'loser_food_master_id'],
    })
  })

  it('defaults dry_run to true, forwards camelCase args to service.merge, and maps the result to snake_case', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      survivor_food_master_id: 'fm_survivor',
      loser_food_master_id: 'fm_loser',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        survivor_food_master_id: 'fm_survivor',
        loser_food_master_id: 'fm_loser',
        applied: false,
        moved_aliases: ['もち米'],
        name_moved_as_alias: 'ロースハム',
        moved_units: [{ unit: '枚', grams_per_unit: 20 }],
        discarded_units: [{ unit: '個', grams_per_unit: 55 }],
        discarded_nutrition: { energy_kcal: 118 },
        moved_meal_log_count: 3,
      },
    })
    expect(calls).toEqual([
      { survivorId: 'fm_survivor', loserId: 'fm_loser', dryRun: true },
    ])
  })

  it('forwards dry_run: false as-is to service.merge', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      survivor_food_master_id: 'fm_survivor',
      loser_food_master_id: 'fm_loser',
      dry_run: false,
    })

    expect(calls).toEqual([
      { survivorId: 'fm_survivor', loserId: 'fm_loser', dryRun: false },
    ])
  })

  it('returns invalid_input for an empty survivor_food_master_id and skips service.merge', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      survivor_food_master_id: '',
      loser_food_master_id: 'fm_loser',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual([])
  })

  it('returns invalid_input when loser_food_master_id is missing and skips service.merge', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      survivor_food_master_id: 'fm_survivor',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'invalid_input',
        message: '<dynamic>',
        details: { issues: { count: 1 } },
      },
    })
    expect(calls).toEqual([])
  })

  it('maps FoodMasterDomainError same_food_master to a namespaced tool error code with details', async () => {
    const { tool } = setup({
      merge: () =>
        errAsync(
          new FoodMasterDomainError(
            'same_food_master',
            'survivor and loser must be different food_master rows',
            { foodMasterId: 'fm_survivor' },
          ),
        ),
    })

    const result = await tool.execute({
      survivor_food_master_id: 'fm_survivor',
      loser_food_master_id: 'fm_survivor',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'food_master/same_food_master',
        message: '<dynamic>',
        details: { foodMasterId: 'fm_survivor' },
      },
    })
  })

  it('maps FoodMasterDomainError food_master_not_found to a namespaced tool error code with details', async () => {
    const { tool } = setup({
      merge: () =>
        errAsync(
          new FoodMasterDomainError(
            'food_master_not_found',
            'food_master not found: fm_missing',
            { foodMasterId: 'fm_missing' },
          ),
        ),
    })

    const result = await tool.execute({
      survivor_food_master_id: 'fm_missing',
      loser_food_master_id: 'fm_loser',
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'food_master/food_master_not_found',
        message: '<dynamic>',
        details: { foodMasterId: 'fm_missing' },
      },
    })
  })
})
