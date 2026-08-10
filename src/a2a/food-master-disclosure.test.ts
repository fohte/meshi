import { describe, expect, it } from 'vitest'

import {
  extractRegisteredFoodMasters,
  withRegisteredFoodMasterDisclosure,
} from '#a2a/food-master-disclosure'
import type { AgentInvokeMessage } from '#llm/agent/derive-reply'

const buildInvokeMessage = (
  type: string,
  overrides: { name?: string; content?: unknown } = {},
): AgentInvokeMessage => ({
  getType: () => type,
  ...(overrides.name !== undefined ? { name: overrides.name } : {}),
  content: overrides.content ?? '',
  text: '',
})

describe('extractRegisteredFoodMasters', () => {
  it('collects every register_food_master / register_food_master_from_composition result from this turn, in turn order', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: JSON.stringify({
          food_master_id: 'fm_1',
          name: 'スターバックス抹茶ラテ',
          source: 'web_search',
          source_url: 'https://example.com/matcha',
          nutrition_per_100g: { energy_kcal: 60, protein_g: 2 },
        }),
      }),
      buildInvokeMessage('tool', {
        name: 'register_food_master_from_composition',
        content: JSON.stringify({
          food_master_id: 'fm_2',
          name: 'そば ゆで',
          composition_code: '01088',
          composition_name: 'そば ゆで',
          nutrition_per_100g: { energy_kcal: 130, protein_g: 4.8 },
        }),
      }),
      buildInvokeMessage('ai', { content: '記録しました。' }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([
      {
        name: 'スターバックス抹茶ラテ',
        energyKcal: 60,
        sourceLabel: 'https://example.com/matcha (web検索)',
      },
      {
        name: 'そば ゆで',
        energyKcal: 130,
        sourceLabel: '成分表「そば ゆで」(コード 01088)',
      },
    ])
  })

  it("labels a user_input registration as the user's own claim", () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: JSON.stringify({
          food_master_id: 'fm_1',
          name: '手作りカレー',
          source: 'user_input',
          source_url: null,
          nutrition_per_100g: { energy_kcal: 200 },
        }),
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([
      {
        name: '手作りカレー',
        energyKcal: 200,
        sourceLabel: 'あなたの申告値',
      },
    ])
  })

  it('returns an empty array for a turn with no registrations', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'record_meal_log',
        content: '{}',
      }),
      buildInvokeMessage('ai', { content: '記録しました。' }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it("does not leak an earlier turn's registration into a later unrelated turn", () => {
    const messages: AgentInvokeMessage[] = [
      // An earlier turn's registration, still present in the
      // checkpointer-accumulated thread history.
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: JSON.stringify({
          food_master_id: 'fm_1',
          name: '手作りカレー',
          source: 'user_input',
          source_url: null,
          nutrition_per_100g: { energy_kcal: 200 },
        }),
      }),
      buildInvokeMessage('ai'),
      // This turn's own exchange never calls a registration tool.
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'record_meal_log',
        content: '{}',
      }),
      buildInvokeMessage('ai', { content: '記録しました。' }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it('skips a register_food_master tool message whose content is not valid JSON', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: 'not json{',
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it('skips a register_food_master tool message whose content does not match the expected schema', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: JSON.stringify({
          error: { code: 'invalid_input', message: 'bad input' },
        }),
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it('skips a register_food_master_from_composition tool message whose content is not valid JSON', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master_from_composition',
        content: 'not json{',
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it('skips a register_food_master_from_composition tool message whose content does not match the expected schema', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master_from_composition',
        content: JSON.stringify({
          error: { code: 'invalid_input', message: 'bad input' },
        }),
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([])
  })

  it('omits the kcal suffix when nutrition has no energy_kcal', () => {
    const messages: AgentInvokeMessage[] = [
      buildInvokeMessage('human'),
      buildInvokeMessage('tool', {
        name: 'register_food_master',
        content: JSON.stringify({
          food_master_id: 'fm_1',
          name: '謎の食品',
          source: 'user_input',
          source_url: null,
          nutrition_per_100g: { protein_g: 5 },
        }),
      }),
    ]

    expect(extractRegisteredFoodMasters(messages)).toEqual([
      {
        name: '謎の食品',
        energyKcal: null,
        sourceLabel: 'あなたの申告値',
      },
    ])
  })
})

describe('withRegisteredFoodMasterDisclosure', () => {
  it('returns the message unchanged when there are no disclosures', () => {
    expect(withRegisteredFoodMasterDisclosure('記録しました。', [])).toBe(
      '記録しました。',
    )
  })

  it('appends a disclosure block listing every registered food in order', () => {
    const result = withRegisteredFoodMasterDisclosure('記録しました。', [
      {
        name: 'スターバックス抹茶ラテ',
        energyKcal: 60,
        sourceLabel: 'https://example.com/matcha (web検索)',
      },
      {
        name: 'そば ゆで',
        energyKcal: 130,
        sourceLabel: '成分表「そば ゆで」(コード 01088)',
      },
    ])

    expect(result).toBe(
      [
        '記録しました。',
        '',
        '新しく登録した食品:',
        '- スターバックス抹茶ラテ 60kcal',
        '  出典: https://example.com/matcha (web検索)',
        '- そば ゆで 130kcal',
        '  出典: 成分表「そば ゆで」(コード 01088)',
        '値が違う場合は教えてください。',
      ].join('\n'),
    )
  })

  it('omits the kcal suffix when energyKcal is null', () => {
    const result = withRegisteredFoodMasterDisclosure('記録しました。', [
      {
        name: '謎の食品',
        energyKcal: null,
        sourceLabel: 'あなたの申告値',
      },
    ])

    expect(result).toBe(
      [
        '記録しました。',
        '',
        '新しく登録した食品:',
        '- 謎の食品',
        '  出典: あなたの申告値',
        '値が違う場合は教えてください。',
      ].join('\n'),
    )
  })
})
