import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMasterDomainError } from '@/domain/food-master/errors'
import type { FoodMasterService } from '@/domain/food-master/service'
import type {
  FoodMaster,
  RegisterFoodMasterInput,
} from '@/domain/food-master/types'
import { normalizeResult } from '@/llm/domain-tools/test-helpers'
import { createRegisterFoodMasterTool } from '@/llm/domain-tools/tools/register-food-master'

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
  nutrition: input.nutrition,
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
    ...override,
  }
  return { tool: createRegisterFoodMasterTool(service), calls }
}

describe('register_food_master tool', () => {
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
      value: { food_master_id: 'fm_new' },
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

  it('omits aliases and source_url when not supplied', async () => {
    const { tool, calls } = setup()

    await tool.execute({
      name: 'おにぎり',
      nutrition_per_100g: { energy_kcal: 168 },
      source: 'composition_table_estimate',
      is_estimated: true,
    })

    expect(calls).toEqual([
      {
        name: 'おにぎり',
        nutrition: { energy_kcal: 168 },
        source: 'composition_table_estimate',
        isEstimated: true,
      },
    ])
  })

  it('rejects unknown source values with invalid_input', async () => {
    const { tool, calls } = setup()

    const result = await tool.execute({
      name: 'X',
      nutrition_per_100g: { energy_kcal: 1 },
      source: 'made_up_source',
      is_estimated: false,
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
