import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type {
  FoodMasterService,
  RegisteredFromComposition,
  RegisterFromCompositionInput,
} from '#domain/food-master/service'
import type { FoodMaster } from '#domain/food-master/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRegisterFoodMasterFromCompositionTool } from '#llm/domain-tools/tools/register-food-master-from-composition'

const sampleFoodMaster = (
  id: string,
  input: RegisterFromCompositionInput,
  compositionName: string,
): FoodMaster => ({
  id,
  name: input.name ?? compositionName,
  aliases: input.aliases ?? [],
  isEstimated: true,
  source: 'composition_table_estimate',
  sourceUrl: null,
  sourceCompositionCode: input.compositionCode,
  nutrition: { energy_kcal: 130, protein_g: 4.8 },
  units: input.units ?? [],
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
})

const setup = (
  override: Partial<FoodMasterService> = {},
): {
  tool: ReturnType<typeof createRegisterFoodMasterFromCompositionTool>
  calls: RegisterFromCompositionInput[]
} => {
  const calls: RegisterFromCompositionInput[] = []
  const service: FoodMasterService = {
    register: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.register not stubbed',
        ),
      ),
    getById: () => okAsync(null),
    registerFromComposition: (input) => {
      calls.push(input)
      const compositionName = 'そば ゆで'
      const foodMaster = sampleFoodMaster('fm_new', input, compositionName)
      const result: RegisteredFromComposition = { foodMaster, compositionName }
      return okAsync(result)
    },
    ...override,
  }
  return { tool: createRegisterFoodMasterFromCompositionTool(service), calls }
}

describe('register_food_master_from_composition tool', () => {
  it('exposes composition_code as the only required field', () => {
    const { tool } = setup()

    const nameField = { type: 'string', minLength: 1, pattern: '\\S' }

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        composition_code: { type: 'string', minLength: 1 },
        name: nameField,
        aliases: { type: 'array', items: nameField },
        units: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              unit: nameField,
              grams_per_unit: { type: 'number', exclusiveMinimum: 0 },
            },
            required: ['unit', 'grams_per_unit'],
          },
        },
      },
      required: ['composition_code'],
    })
  })

  it('bridges snake_case input to FoodMasterService.registerFromComposition and returns the composition name/code', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ composition_code: '01088' })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        food_master_id: 'fm_new',
        name: 'そば ゆで',
        composition_code: '01088',
        composition_name: 'そば ゆで',
        nutrition_per_100g: { energy_kcal: 130, protein_g: 4.8 },
      },
    })
    expect(calls).toEqual([{ compositionCode: '01088' }])
  })

  it('bridges an overriding name/aliases/units to FoodMasterService.registerFromComposition', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      composition_code: '01088',
      name: 'カスタムそば',
      aliases: ['そば'],
      units: [{ unit: '個', grams_per_unit: 120 }],
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        food_master_id: 'fm_new',
        name: 'カスタムそば',
        composition_code: '01088',
        composition_name: 'そば ゆで',
        nutrition_per_100g: { energy_kcal: 130, protein_g: 4.8 },
      },
    })
    expect(calls).toEqual([
      {
        compositionCode: '01088',
        name: 'カスタムそば',
        aliases: ['そば'],
        units: [{ unit: '個', gramsPerUnit: 120 }],
      },
    ])
  })

  it('returns invalid_input for an empty composition_code', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({ composition_code: '' })

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

  it('returns invalid_input for aliases that duplicate each other after trimming', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      composition_code: '01088',
      aliases: ['そば', ' そば '],
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

  it('maps a composition_not_found FoodMasterDomainError to a namespaced tool error code with details', async () => {
    const { tool } = setup({
      registerFromComposition: () =>
        errAsync(
          new FoodMasterDomainError(
            'composition_not_found',
            'food_composition not found: 99999',
            { compositionCode: '99999' },
          ),
        ),
    })

    const result = await tool.execute({ composition_code: '99999' })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'food_master/composition_not_found',
        message: '<dynamic>',
        details: { compositionCode: '99999' },
      },
    })
  })
})
