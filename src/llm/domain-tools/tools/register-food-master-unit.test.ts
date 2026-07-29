import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMasterUnitDomainError } from '#domain/food-master-unit/errors'
import type { FoodMasterUnitService } from '#domain/food-master-unit/service'
import type { RegisterFoodMasterUnitInput } from '#domain/food-master-unit/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRegisterFoodMasterUnitTool } from '#llm/domain-tools/tools/register-food-master-unit'

const setup = (
  override: Partial<FoodMasterUnitService> = {},
): {
  tool: ReturnType<typeof createRegisterFoodMasterUnitTool>
  calls: RegisterFoodMasterUnitInput[]
} => {
  const calls: RegisterFoodMasterUnitInput[] = []
  const service: FoodMasterUnitService = {
    register: (input) => {
      calls.push(input)
      return okAsync({
        foodMasterId: input.foodMasterId,
        unit: input.unit,
        gramsPerUnit: input.gramsPerUnit,
      })
    },
    ...override,
  }
  return { tool: createRegisterFoodMasterUnitTool(service), calls }
}

describe('register_food_master_unit tool', () => {
  it('exposes food_master_id/unit/grams_per_unit as required fields', () => {
    const { tool } = setup()

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        food_master_id: { type: 'string', minLength: 1 },
        unit: { type: 'string', minLength: 1, pattern: '\\S' },
        grams_per_unit: { type: 'number', exclusiveMinimum: 0 },
      },
      required: ['food_master_id', 'unit', 'grams_per_unit'],
    })
  })

  it('bridges snake_case input to FoodMasterUnitService.register and returns it snake_case', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_egg',
      unit: '個',
      grams_per_unit: 55,
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: { food_master_id: 'fm_egg', unit: '個', grams_per_unit: 55 },
    })
    expect(calls).toEqual([
      { foodMasterId: 'fm_egg', unit: '個', gramsPerUnit: 55 },
    ])
  })

  it('returns invalid_input for a whitespace-only unit', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_egg',
      unit: '   ',
      grams_per_unit: 55,
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

  it('returns invalid_input for a non-positive grams_per_unit', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      food_master_id: 'fm_egg',
      unit: '個',
      grams_per_unit: 0,
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

  it('maps FoodMasterUnitDomainError to a namespaced tool error code with details', async () => {
    const { tool } = setup({
      register: () =>
        errAsync(
          new FoodMasterUnitDomainError(
            'food_master_not_found',
            'food_master not found: fm_missing',
            { foodMasterId: 'fm_missing' },
          ),
        ),
    })

    const result = await tool.execute({
      food_master_id: 'fm_missing',
      unit: '個',
      grams_per_unit: 55,
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'food_master_unit/food_master_not_found',
        message: '<dynamic>',
        details: { foodMasterId: 'fm_missing' },
      },
    })
  })
})
