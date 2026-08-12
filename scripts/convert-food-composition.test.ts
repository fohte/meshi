import { describe, expect, it } from 'vitest'

import {
  buildRows,
  columnLetter,
  combineHeader,
  parseCsv,
  parseNutrientValue,
  resolveColumns,
  type ResolvedColumns,
} from '#scripts/convert-food-composition'

describe('parseCsv', () => {
  it('splits fields and unwraps quoted fields with embedded commas and escaped quotes', () => {
    const text = 'a,"b, ""quoted""",c\n1,2,3\n'
    expect(parseCsv(text)).toEqual([
      ['a', 'b, "quoted"', 'c'],
      ['1', '2', '3'],
    ])
  })

  it('flushes the last row when the input has no trailing newline', () => {
    expect(parseCsv('a,b')).toEqual([['a', 'b']])
  })
})

describe('columnLetter', () => {
  it('produces spreadsheet-style column letters', () => {
    expect([0, 1, 25, 26, 27].map(columnLetter)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
    ])
  })
})

describe('combineHeader', () => {
  it('concatenates non-empty header cells for a column across header rows', () => {
    const headerRows = [
      ['食品番号', 'エネルギー', 'たんぱく質', ''],
      ['', 'kcal', 'アミノ酸組成による', 'g'],
    ]
    expect([0, 1, 2, 3].map((i) => combineHeader(headerRows, i))).toEqual([
      '食品番号',
      'エネルギーkcal',
      'たんぱく質アミノ酸組成による',
      'g',
    ])
  })
})

describe('parseNutrientValue', () => {
  it.each([
    ['156', 156],
    ['2.5', 2.5],
    ['0', 0],
    ['Tr', 0],
    ['(Tr)', 0],
    ['(2.5)', 2.5],
    ['-', undefined],
    ['', undefined],
    ['n/a', undefined],
  ])('parses %s as %s', (raw, expected) => {
    expect(parseNutrientValue(raw)).toBe(expected)
  })
})

describe('resolveColumns', () => {
  // Row 1: nutrient/group label. Row 2: qualifier or unit. Columns with a
  // qualifier that should exclude them from a matcher (アミノ酸組成による
  // たんぱく質, 脂肪酸のトリアシルグリセロール当量, 利用可能炭水化物,
  // 差引き法による..., ナイアシン当量, kJ energy) sit next to the plain
  // column they must not be confused with, mirroring the real table's
  // layout of sibling columns under the same group.
  const headerRows = [
    [
      '食品番号',
      '食品名',
      'エネルギー',
      'エネルギー',
      'たんぱく質',
      'たんぱく質',
      '脂質',
      'コレステロール',
      '脂質',
      '食物繊維総量',
      '利用可能炭水化物',
      '差引き法による利用可能炭水化物',
      '炭水化物',
      'ナトリウム',
      'カリウム',
      'カルシウム',
      'マグネシウム',
      'リン',
      '鉄',
      '亜鉛',
      '銅',
      'レチノール活性当量',
      'ビタミンD',
      'ビタミンK',
      'ビタミンB1',
      'ビタミンB12',
      'ビタミンB2',
      'ナイアシン',
      'ナイアシン',
      'ビタミンB6',
      '葉酸',
      'パントテン酸',
      'ビオチン',
      'ビタミンC',
      '食塩相当量',
    ],
    [
      '',
      '',
      'kcal',
      'kJ',
      'アミノ酸組成による',
      '',
      '脂肪酸のトリアシルグリセロール当量',
      '',
      '',
      '',
      '単糖当量',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      '当量',
      '',
      '',
      '',
      '',
      '',
      '',
      '',
    ],
  ]
  const columnCount = headerRows[0]?.length ?? 0

  it('maps code, name, and every known nutrient column by header text, resolving lookalikes', () => {
    expect(resolveColumns(headerRows, columnCount)._unsafeUnwrap()).toEqual({
      codeColumn: 0,
      nameColumn: 1,
      nutrientColumns: new Map([
        [2, 'energy_kcal'],
        [5, 'protein_g'],
        [7, 'cholesterol_mg'],
        [8, 'fat_g'],
        [9, 'dietary_fiber_g'],
        [12, 'carb_g'],
        [13, 'sodium_mg'],
        [14, 'potassium_mg'],
        [15, 'calcium_mg'],
        [16, 'magnesium_mg'],
        [17, 'phosphorus_mg'],
        [18, 'iron_mg'],
        [19, 'zinc_mg'],
        [20, 'copper_mg'],
        [21, 'vitamin_a_µg'],
        [22, 'vitamin_d_µg'],
        [23, 'vitamin_k_µg'],
        [24, 'vitamin_b1_mg'],
        [25, 'vitamin_b12_µg'],
        [26, 'vitamin_b2_mg'],
        [28, 'niacin_mg'],
        [29, 'vitamin_b6_mg'],
        [30, 'folate_µg'],
        [31, 'pantothenic_acid_mg'],
        [32, 'biotin_µg'],
        [33, 'vitamin_c_mg'],
        [34, 'salt_g'],
      ]),
      unmatchedNutrientCodes: [],
      ambiguousNutrientCodes: [],
    })
  })

  it('errors when the code column cannot be found', () => {
    expect(resolveColumns([['食品名']], 1)._unsafeUnwrapErr().message).toBe(
      'no column matched 食品番号',
    )
  })

  it('errors when a required column matches ambiguously', () => {
    expect(
      resolveColumns([['食品番号', '食品名', '食品名']], 3)._unsafeUnwrapErr()
        .message,
    ).toBe('ambiguous columns for 食品名: B, C')
  })

  it('separates nutrient codes with no matching column from ones matched ambiguously', () => {
    const resolved = resolveColumns(
      [['食品番号', '食品名', '食物繊維総量', '食物繊維総量']],
      4,
    )._unsafeUnwrap()

    expect(resolved).toEqual({
      codeColumn: 0,
      nameColumn: 1,
      nutrientColumns: new Map(),
      ambiguousNutrientCodes: ['dietary_fiber_g'],
      unmatchedNutrientCodes: [
        'energy_kcal',
        'protein_g',
        'fat_g',
        'carb_g',
        'salt_g',
        'cholesterol_mg',
        'sodium_mg',
        'potassium_mg',
        'calcium_mg',
        'magnesium_mg',
        'phosphorus_mg',
        'iron_mg',
        'zinc_mg',
        'copper_mg',
        'vitamin_a_µg',
        'vitamin_d_µg',
        'vitamin_k_µg',
        'vitamin_b1_mg',
        'vitamin_b2_mg',
        'niacin_mg',
        'vitamin_b6_mg',
        'vitamin_b12_µg',
        'folate_µg',
        'pantothenic_acid_mg',
        'biotin_µg',
        'vitamin_c_mg',
      ],
    })
  })
})

describe('buildRows', () => {
  it('zero-pads codes, skips non-food rows, and reports empty-name/unparseable-value warnings', () => {
    const columns: ResolvedColumns = {
      codeColumn: 0,
      nameColumn: 1,
      nutrientColumns: new Map([
        [2, 'energy_kcal'],
        [3, 'salt_g'],
      ]),
      unmatchedNutrientCodes: [],
      ambiguousNutrientCodes: [],
    }
    const dataRows = [
      ['1 穀類', '', '', ''], // food-group header row, no numeric code
      ['1088', 'こめ 精白米', '156', '0'],
      ['1089', 'こめ 玄米', '165', 'Tr'],
      ['1090', '欠測サンプル', '-', '-'],
      ['1091', '', '100', '1'], // empty name, dropped
      ['1092', '不明食品', 'abc', '1'], // unparseable energy value
    ]

    expect(buildRows(dataRows, columns)).toEqual({
      rows: [
        {
          code: '01088',
          name: 'こめ 精白米',
          nutrients: { energy_kcal: 156, salt_g: 0 },
        },
        {
          code: '01089',
          name: 'こめ 玄米',
          nutrients: { energy_kcal: 165, salt_g: 0 },
        },
        { code: '01090', name: '欠測サンプル', nutrients: {} },
        { code: '01092', name: '不明食品', nutrients: { salt_g: 1 } },
      ],
      warnings: [
        'skipped food code 01091: empty name',
        'food 01092: unparseable value "abc" for energy_kcal, skipped',
      ],
    })
  })
})
