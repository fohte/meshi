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

const observation = <T extends object>(value: T): T => value

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
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
})

const setup = (
  override: Partial<FoodMasterService> = {},
): {
  tool: ReturnType<typeof createRegisterFoodMasterTool>
  calls: Array<{
    input: RegisterFoodMasterInput
    confirmedDistinctFromMasterIds?: ReadonlyArray<string>
  }>
} => {
  const calls: Array<{
    input: RegisterFoodMasterInput
    confirmedDistinctFromMasterIds?: ReadonlyArray<string>
  }> = []
  const defaultRegisterWithSimilarNameCheck: FoodMasterService['registerWithSimilarNameCheck'] =
    (input) => okAsync(sampleMaster('fm_new', input))
  const registerHandler =
    override.registerWithSimilarNameCheck ?? defaultRegisterWithSimilarNameCheck
  const service: FoodMasterService = {
    getById: () => okAsync(null),
    findSimilarNames: () => okAsync([]),
    registerFromComposition: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.registerFromComposition not stubbed',
        ),
      ),
    addAlias: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.addAlias not stubbed',
        ),
      ),
    merge: () =>
      errAsync(
        new FoodMasterDomainError(
          'persistence_failed',
          'foodMasterService.merge not stubbed',
        ),
      ),
    ...override,
    registerWithSimilarNameCheck: (input, confirmedDistinctFromMasterIds) => {
      calls.push({
        input,
        ...(confirmedDistinctFromMasterIds === undefined
          ? {}
          : { confirmedDistinctFromMasterIds }),
      })
      return registerHandler(input, confirmedDistinctFromMasterIds)
    },
  }
  return { tool: createRegisterFoodMasterTool(service), calls }
}

describe('register_food_master tool', () => {
  it('exposes the registered nutrient codes as a closed enum in nutrition_per_basis so the LLM never has to guess one', () => {
    const { tool } = setup()

    const nameField = { type: 'string', minLength: 1, pattern: '\\S' }

    expect(tool.inputSchema).toEqual({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      properties: {
        name: nameField,
        aliases: { type: 'array', items: nameField },
        nutrition_per_basis: {
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
        confirmed_distinct_from_master_ids: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
        },
      },
      required: ['name', 'nutrition_per_basis', 'source', 'is_estimated'],
    })
  })

  it('bridges snake_case input to FoodMasterService.registerWithSimilarNameCheck and returns the new id', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      name: 'バナナ',
      aliases: ['banana'],
      nutrition_per_basis: { energy_kcal: 89, protein_g: 1.1 },
      source: 'web_search',
      is_estimated: false,
      source_url: 'https://example.test/banana',
      confirmed_distinct_from_master_ids: ['fm_verified'],
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: true,
        value: {
          food_master_id: 'fm_new',
          name: 'バナナ',
          source: 'web_search',
          source_url: 'https://example.test/banana',
          nutrition_per_100g: { energy_kcal: 89, protein_g: 1.1 },
        },
      },
      calls: [
        {
          input: {
            name: 'バナナ',
            aliases: ['banana'],
            nutrition: { energy_kcal: 89, protein_g: 1.1 },
            source: 'web_search',
            isEstimated: false,
            sourceUrl: 'https://example.test/banana',
          },
          confirmedDistinctFromMasterIds: ['fm_verified'],
        },
      ],
    })
  })

  it('omits aliases and source_url and still accepts nutrition without energy_kcal', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      name: 'おにぎり',
      nutrition_per_basis: { protein_g: 2.5 },
      source: 'user_input',
      is_estimated: true,
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: true,
        value: {
          food_master_id: 'fm_new',
          name: 'おにぎり',
          source: 'user_input',
          source_url: null,
          nutrition_per_100g: { protein_g: 2.5 },
        },
      },
      calls: [
        {
          input: {
            name: 'おにぎり',
            nutrition: { protein_g: 2.5 },
            source: 'user_input',
            isEstimated: true,
          },
        },
      ],
    })
  })

  it.each([
    {
      label: 'empty nutrition_per_basis',
      input: {
        name: 'X',
        nutrition_per_basis: {},
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'an unknown source value',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'made_up_source',
        is_estimated: false,
      },
    },
    {
      label:
        'a composition_table_estimate source (no longer accepted by this tool)',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'composition_table_estimate',
        is_estimated: true,
      },
    },
    {
      label: 'is_estimated=true combined with source=web_search',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: true,
        source_url: 'https://example.test',
      },
    },
    {
      label: 'source=web_search without source_url',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: false,
      },
    },
    {
      label: 'source_url present with source=user_input',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
        source_url: 'https://example.test',
      },
    },
    {
      label: 'a source_url containing control characters',
      input: {
        name: 'X',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'web_search',
        is_estimated: false,
        source_url: 'https://example.test/\ninjected',
      },
    },
    {
      label: 'a whitespace-only name',
      input: {
        name: '  ',
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'a whitespace-only alias',
      input: {
        name: 'X',
        aliases: ['  '],
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
    {
      label: 'aliases that duplicate each other after trimming',
      input: {
        name: 'X',
        aliases: ['banana', ' banana '],
        nutrition_per_basis: { energy_kcal: 1 },
        source: 'user_input',
        is_estimated: false,
      },
    },
  ])('rejects $label with invalid_input', async ({ input }) => {
    const { tool, calls } = setup()

    const result = await tool.execute(input)

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: '<dynamic>',
          details: { issues: { count: 1 } },
        },
      },
      calls: [],
    })
  })

  it('maps FoodMasterDomainError to a namespaced tool error code with details', async () => {
    const { tool, calls } = setup({
      registerWithSimilarNameCheck: () =>
        errAsync(
          new FoodMasterDomainError('duplicate_name', 'duplicate name', {
            name: 'バナナ',
          }),
        ),
    })

    const result = await tool.execute({
      name: 'バナナ',
      nutrition_per_basis: { energy_kcal: 89 },
      source: 'user_input',
      is_estimated: false,
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: false,
        error: {
          code: 'food_master/duplicate_name',
          message: '<dynamic>',
          details: { name: 'バナナ' },
        },
      },
      calls: [
        {
          input: {
            name: 'バナナ',
            nutrition: { energy_kcal: 89 },
            source: 'user_input',
            isEstimated: false,
          },
        },
      ],
    })
  })

  it('maps the service similar-name error and its candidates to the LLM tool error', async () => {
    const { tool, calls } = setup({
      registerWithSimilarNameCheck: () =>
        errAsync(
          new FoodMasterDomainError(
            'similar_name_exists',
            'existing food_master(s) with a similar name were found; reuse one of them if it is the same product, gather stronger evidence and retry if unsure, ask the user to disambiguate, or retry with confirmed_distinct_from_master_ids listing exactly these food_master_id values once you have verified this is a different product',
            {
              candidates: [
                {
                  food_master_id: 'fm_existing_1',
                  name: 'ごろごろ野菜カレー 中辛',
                  score: 0.33,
                },
              ],
            },
          ),
        ),
    })

    const result = await tool.execute({
      name: 'ごろごろ野菜カレー レトルト',
      nutrition_per_basis: { energy_kcal: 89 },
      source: 'user_input',
      is_estimated: false,
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: false,
        error: {
          code: 'food_master/similar_name_exists',
          message: '<dynamic>',
          details: {
            candidates: [
              {
                food_master_id: 'fm_existing_1',
                name: 'ごろごろ野菜カレー 中辛',
                score: 0.33,
              },
            ],
          },
        },
      },
      calls: [
        {
          input: {
            name: 'ごろごろ野菜カレー レトルト',
            nutrition: { energy_kcal: 89 },
            source: 'user_input',
            isEstimated: false,
          },
        },
      ],
    })
  })

  it('forwards confirmed distinct candidate ids with the registration request', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      name: 'ごろごろ野菜カレー レトルト',
      nutrition_per_basis: { energy_kcal: 89 },
      source: 'user_input',
      is_estimated: false,
      confirmed_distinct_from_master_ids: ['fm_existing_1'],
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: true,
        value: {
          food_master_id: 'fm_new',
          name: 'ごろごろ野菜カレー レトルト',
          source: 'user_input',
          source_url: null,
          nutrition_per_100g: { energy_kcal: 89 },
        },
      },
      calls: [
        {
          input: {
            name: 'ごろごろ野菜カレー レトルト',
            nutrition: { energy_kcal: 89 },
            source: 'user_input',
            isEstimated: false,
          },
          confirmedDistinctFromMasterIds: ['fm_existing_1'],
        },
      ],
    })
  })

  it('maps a similar-name lookup failure to a namespaced tool error', async () => {
    const { tool, calls } = setup({
      registerWithSimilarNameCheck: () =>
        errAsync(
          new FoodMasterDomainError(
            'persistence_failed',
            'similarity lookup failed',
          ),
        ),
    })

    const result = await tool.execute({
      name: 'バナナ',
      nutrition_per_basis: { energy_kcal: 89 },
      source: 'user_input',
      is_estimated: false,
    })

    expect(observation({ result: normalizeResult(result), calls })).toEqual({
      result: {
        ok: false,
        error: {
          code: 'food_master/persistence_failed',
          message: '<dynamic>',
          details: {},
        },
      },
      calls: [
        {
          input: {
            name: 'バナナ',
            nutrition: { energy_kcal: 89 },
            source: 'user_input',
            isEstimated: false,
          },
        },
      ],
    })
  })
})
