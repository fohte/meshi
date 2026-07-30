import { describe, expect, it } from 'vitest'

import type { NutrientDefinition } from '#api/nutrient-definitions'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'

const DEFINITIONS: ReadonlyArray<NutrientDefinition> = [
  {
    code: 'energy_kcal',
    displayName: 'エネルギー',
    unit: 'kcal',
    isMajor: true,
    sortOrder: 1,
  },
  {
    code: 'protein_g',
    displayName: 'たんぱく質',
    unit: 'g',
    isMajor: true,
    sortOrder: 2,
  },
  {
    code: 'fat_g',
    displayName: '脂質',
    unit: 'g',
    isMajor: true,
    sortOrder: 3,
  },
  {
    code: 'carb_g',
    displayName: '炭水化物',
    unit: 'g',
    isMajor: true,
    sortOrder: 4,
  },
  {
    code: 'iron_mg',
    displayName: '鉄',
    unit: 'mg',
    isMajor: false,
    sortOrder: 5,
  },
]

// Empty totals ({}) and no targets (null or {}) both produce this same
// zeroed-out shape — reused by both no-target tests below.
const zeroTotalsNoTargetResult = {
  energy: { value: 0, target: null, pct: null, over: false },
  pfc: {
    segments: [
      {
        label: 'たんぱく質',
        color: 'var(--color-text)',
        pct: 0,
        targetPct: 20,
      },
      { label: '脂質', color: 'var(--color-muted)', pct: 0, targetPct: 25 },
      { label: '炭水化物', color: '#3f3f46', pct: 0, targetPct: 55 },
    ],
    targetMarks: [20, 45],
  },
  majorRows: [
    {
      code: 'protein_g',
      label: 'たんぱく質',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'fat_g',
      label: '脂質',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'carb_g',
      label: '炭水化物',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
  ],
  allRows: [
    {
      code: 'energy_kcal',
      label: 'エネルギー',
      unit: 'kcal',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'protein_g',
      label: 'たんぱく質',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'fat_g',
      label: '脂質',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'carb_g',
      label: '炭水化物',
      unit: 'g',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
    {
      code: 'iron_mg',
      label: '鉄',
      unit: 'mg',
      value: 0,
      target: null,
      pct: 0,
      over: false,
    },
  ],
  hasAnyTarget: false,
}

describe('buildNutritionSummaryData', () => {
  it('builds energy, PFC, and nutrient rows from totals/definitions/targets', () => {
    const totals = {
      energy_kcal: 1800,
      protein_g: 90, // 360 kcal
      fat_g: 50, // 450 kcal
      carb_g: 247.5, // 990 kcal
      iron_mg: 5,
    }
    const targets = { energy_kcal: 2200, protein_g: 110 }

    const result = buildNutritionSummaryData(totals, DEFINITIONS, targets)

    const proteinPct = (90 / 110) * 100

    expect(result).toEqual({
      energy: {
        value: 1800,
        target: 2200,
        pct: (1800 / 2200) * 100,
        over: false,
      },
      pfc: {
        segments: [
          {
            label: 'たんぱく質',
            color: 'var(--color-text)',
            pct: (360 / 1800) * 100,
            targetPct: 20,
          },
          {
            label: '脂質',
            color: 'var(--color-muted)',
            pct: (450 / 1800) * 100,
            targetPct: 25,
          },
          {
            label: '炭水化物',
            color: '#3f3f46',
            pct: (990 / 1800) * 100,
            targetPct: 55,
          },
        ],
        targetMarks: [20, 45],
      },
      majorRows: [
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 90,
          target: 110,
          pct: proteinPct,
          over: false,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 50,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 247.5,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      allRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 1800,
          target: 2200,
          pct: (1800 / 2200) * 100,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 90,
          target: 110,
          pct: proteinPct,
          over: false,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 50,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 247.5,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 5,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      hasAnyTarget: true,
    })
  })

  it('marks a row as over target once it exceeds 110% of target', () => {
    const totals = { protein_g: 122 }
    const targets = { protein_g: 110 } // 122/110 = 110.9...%

    const result = buildNutritionSummaryData(totals, DEFINITIONS, targets)
    const proteinPct = (122 / 110) * 100

    expect(result).toEqual({
      energy: { value: 0, target: null, pct: null, over: false },
      pfc: {
        segments: [
          {
            label: 'たんぱく質',
            color: 'var(--color-text)',
            pct: 100,
            targetPct: 20,
          },
          { label: '脂質', color: 'var(--color-muted)', pct: 0, targetPct: 25 },
          { label: '炭水化物', color: '#3f3f46', pct: 0, targetPct: 55 },
        ],
        targetMarks: [20, 45],
      },
      majorRows: [
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 122,
          target: 110,
          pct: proteinPct,
          over: true,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      allRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 122,
          target: 110,
          pct: proteinPct,
          over: true,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      hasAnyTarget: true,
    })
  })

  it('derives targetPct/targetMarks from daily targets once energy/protein/fat/carb are all set', () => {
    const totals = { energy_kcal: 1800, protein_g: 90, fat_g: 50, carb_g: 200 }
    const targets = {
      energy_kcal: 2150,
      protein_g: 132,
      fat_g: 60,
      carb_g: 270,
    }

    const result = buildNutritionSummaryData(totals, DEFINITIONS, targets)

    expect(result.pfc).toEqual({
      segments: [
        {
          label: 'たんぱく質',
          color: 'var(--color-text)',
          pct: 22.36024844720497,
          targetPct: 24.558139534883722,
        },
        {
          label: '脂質',
          color: 'var(--color-muted)',
          pct: 27.95031055900621,
          targetPct: 25.116279069767444,
        },
        {
          label: '炭水化物',
          color: '#3f3f46',
          pct: 49.68944099378882,
          targetPct: 50.23255813953489,
        },
      ],
      targetMarks: [24.558139534883722, 49.674418604651166],
    })
  })

  it.each([
    [
      'carb_g target is missing',
      { energy_kcal: 2150, protein_g: 132, fat_g: 60 },
    ],
    [
      'energy_kcal target is 0',
      { energy_kcal: 0, protein_g: 132, fat_g: 60, carb_g: 270 },
    ],
    [
      'protein_g target is negative',
      { energy_kcal: 2150, protein_g: -10, fat_g: 60, carb_g: 270 },
    ],
  ])('falls back to the default PFC ratio when %s', (_description, targets) => {
    const result = buildNutritionSummaryData({}, DEFINITIONS, targets)

    expect(result.pfc).toEqual({
      segments: [
        {
          label: 'たんぱく質',
          color: 'var(--color-text)',
          pct: 0,
          targetPct: 20,
        },
        {
          label: '脂質',
          color: 'var(--color-muted)',
          pct: 0,
          targetPct: 25,
        },
        {
          label: '炭水化物',
          color: '#3f3f46',
          pct: 0,
          targetPct: 55,
        },
      ],
      targetMarks: [20, 45],
    })
  })

  it('defaults missing totals to 0 and reports no target when targets is null', () => {
    const result = buildNutritionSummaryData({}, DEFINITIONS, null)

    expect(result).toEqual(zeroTotalsNoTargetResult)
  })

  it('reports no target when targets is an empty object', () => {
    const result = buildNutritionSummaryData({}, DEFINITIONS, {})

    expect(result).toEqual(zeroTotalsNoTargetResult)
  })

  it('treats a target of 0 as unusable instead of producing NaN/Infinity%', () => {
    const totals = { energy_kcal: 1800, protein_g: 90 }
    const targets = { energy_kcal: 0, protein_g: 0 }

    const result = buildNutritionSummaryData(totals, DEFINITIONS, targets)

    expect(result).toEqual({
      energy: { value: 1800, target: 0, pct: null, over: false },
      pfc: {
        segments: [
          {
            label: 'たんぱく質',
            color: 'var(--color-text)',
            pct: 100,
            targetPct: 20,
          },
          { label: '脂質', color: 'var(--color-muted)', pct: 0, targetPct: 25 },
          { label: '炭水化物', color: '#3f3f46', pct: 0, targetPct: 55 },
        ],
        targetMarks: [20, 45],
      },
      majorRows: [
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 90,
          target: 0,
          pct: 0,
          over: false,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      allRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 1800,
          target: 0,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 90,
          target: 0,
          pct: 0,
          over: false,
        },
        {
          code: 'fat_g',
          label: '脂質',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'carb_g',
          label: '炭水化物',
          unit: 'g',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 0,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      hasAnyTarget: true,
    })
  })
})
