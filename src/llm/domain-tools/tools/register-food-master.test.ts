import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type {
  FoodMaster,
  RegisterFoodMasterInput,
} from '#domain/food-master/types'
import { normalizeResult } from '#llm/domain-tools/test-helpers'
import { createRegisterFoodMasterTool } from '#llm/domain-tools/tools/register-food-master'

const sampleMaster = (
  id: string,
  input: RegisterFoodMasterInput,
): FoodMaster => ({
  id,
  name: input.name,
  aliases: input.aliases ?? [],
  isEstimated: input.isEstimated,
  source: input.source,
  sourceUrl: input.sourceUrl ?? null,
  sourceCompositionCode: input.sourceCompositionCode ?? null,
  nutrition: input.nutrition,
  units: input.units ?? [],
  basisQuantity: 100,
  basisUnit: 'g',
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
})

const setup = (
  override: Partial<FoodMasterService> = {},
): {
  tool: ReturnType<typeof createRegisterFoodMasterTool>
  calls: RegisterFoodMasterInput[]
} => {
  const calls: RegisterFoodMasterInput[] = []
  const service: FoodMasterService = {
    register: (input) => {
      calls.push(input)
      return okAsync(sampleMaster('fm_new', input))
    },
    getById: () => okAsync(null),
    registerFromComposition: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.registerFromComposition not stubbed',
        ),
      ),
    ...override,
  }
  return { tool: createRegisterFoodMasterTool(service), calls }
}

describe('register_food_master tool', () => {
  it('exposes the registered nutrient codes as a closed enum in nutrition_per_100g so the LLM never has to guess one', () => {
    const { tool } = setup()

    const nameField = { type: 'string', minLength: 1, pattern: '\\S' }

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        name: nameField,
        aliases: { type: 'array', items: nameField },
        nutrition_per_100g: {
          type: 'object',
          propertyNames: { type: 'string', enum: [...NUTRIENT_CODES] },
          additionalProperties: { type: 'number', minimum: 0 },
        },
        source: {
          type: 'string',
          enum: ['web_search', 'user_input'],
        },
        is_estimated: { type: 'boolean' },
        source_url: { type: 'string', format: 'uri' },
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
      required: ['name', 'nutrition_per_100g', 'source', 'is_estimated'],
    })
  })

  it('bridges snake_case input to FoodMasterService.register and returns the new id', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      name: 'バナナ',
      aliases: ['banana'],
      nutrition_per_100g: { energy_kcal: 89, protein_g: 1.1 },
      source: 'web_search',
      is_estimated: false,
      source_url: 'https://example.test/banana',
    })

    expect(normalizeResult(result)).toEqual({
      ok: true,
      value: {
        food_master_id: 'fm_new',
        name: 'バナナ',
        source: 'web_search',
        source_url: 'https://example.test/banana',
        nutrition_per_100g: { energy_kcal: 89, protein_g: 1.1 },
      },
    })
    expect(calls).toEqual([
      {
        name: 'バナナ',
        aliases: ['banana'],
        nutrition: { energy_kcal: 89, protein_g: 1.1 },
        source: 'web_search',
        isEstimated: false,
        sourceUrl: 'https://example.test/banana',
      },
    ])
  })

  it('bridges units to gramsPerUnit-shaped input for FoodMasterService.register', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      name: '卵',
      nutrition_per_100g: { energy_kcal: 151 },
      source: 'user_input',
      is_estimated: false,
      units: [{ unit: '個', grams_per_unit: 55 }],
    })

    expect(calls).toEqual([
      {
        name: '卵',
        nutrition: { energy_kcal: 151 },
        source: 'user_input',
        isEstimated: false,
        units: [{ unit: '個', gramsPerUnit: 55 }],
      },
    ])
  })

  it('omits aliases and source_url when not supplied', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      name: 'おにぎり',
      nutrition_per_100g: { energy_kcal: 168 },
      source: 'user_input',
      is_estimated: true,
    })

    expect(calls).toEqual([
      {
        name: 'おにぎり',
        nutrition: { energy_kcal: 168 },
        source: 'user_input',
        isEstimated: true,
      },
    ])
  })

  it.each([
    {
      label: 'an unknown source value',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'made_up_source',
        is_estimated: false,
      },
    },
    {
      label:
        'a composition_table_estimate source (no longer accepted by this tool)',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'composition_table_estimate',
        is_estimated: true,
      },
    },
    {
      label: 'is_estimated=true combined with source=web_search',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: true,
        source_url: 'https://example.test',
      },
    },
    {
      label: 'source=web_search without source_url',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: false,
      },
    },
    {
      label: 'source_url present with source=user_input',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
        source_url: 'https://example.test',
      },
    },
    {
      label: 'a source_url containing control characters',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: false,
        source_url: 'https://example.test/\ninjected',
      },
    },
    {
      label: 'a whitespace-only name',
      input: {
        name: '  ',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'a whitespace-only alias',
      input: {
        name: 'X',
        aliases: ['  '],
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'aliases that duplicate each other after trimming',
      input: {
        name: 'X',
        aliases: ['banana', ' banana '],
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'a non-positive grams_per_unit',
      input: {
        name: 'X',
        nutrition_per_100g: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
        units: [{ unit: '個', grams_per_unit: 0 }],
      },
    },
  ])('rejects $label with invalid_input', async ({ input }) => {
    const { tool, calls } = setup()

    const result = await tool.execute(input)

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

  it('maps FoodMasterDomainError to a namespaced tool error code with details', async () => {
    const { tool } = setup({
      register: () =>
        errAsync(
          new FoodMasterDomainError('duplicate_name', 'duplicate name', {
            name: 'バナナ',
          }),
        ),
    })

    const result = await tool.execute({
      name: 'バナナ',
      nutrition_per_100g: { energy_kcal: 89 },
      source: 'user_input',
      is_estimated: false,
    })

    expect(normalizeResult(result)).toEqual({
      ok: false,
      error: {
        code: 'food_master/duplicate_name',
        message: '<dynamic>',
        details: { name: 'バナナ' },
      },
    })
  })
})
