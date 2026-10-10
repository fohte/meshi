import { describe, expect, it } from 'vitest'

import type { NutrientDefinition } from '#api/nutrient-definitions'
import { buildReportData } from '#pages/history/build-report-data'

const DEFINITIONS: readonly NutrientDefinition[] = [
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
    code: 'iron_mg',
    displayName: '鉄',
    unit: 'mg',
    isMajor: false,
    sortOrder: 3,
  },
]

describe('buildReportData', () => {
  it('builds a week of day bars, an energy-first avg block, and a full nutrient table', () => {
    const perDayTotals = new Map([
      [
        '2026-07-27',
        {
          totals: { energy_kcal: 1800, protein_g: 80, iron_mg: 6 },
          hasUnknownValues: false,
        },
      ],
      [
        '2026-07-29',
        {
          totals: { energy_kcal: 2500, protein_g: 120, iron_mg: 8 },
          hasUnknownValues: false,
        },
      ],
    ])
    const periodDates = [
      '2026-07-26',
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]

    const result = buildReportData(
      periodDates,
      'week',
      perDayTotals,
      DEFINITIONS,
      { energy_kcal: 2200, protein_g: 100 },
    )

    // maxHeight = max(2200*1.2=2640, max kcal 2500) = 2640
    expect(result).toEqual({
      rangeText: '7月26日 – 8月1日',
      days: [
        {
          date: '2026-07-26',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '日',
        },
        {
          date: '2026-07-27',
          kcal: 1800,
          hasUnknownValues: false,
          heightPct: (1800 / 2640) * 100,
          hasData: true,
          isOverTarget: false,
          label: '月',
        },
        {
          date: '2026-07-28',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '火',
        },
        {
          date: '2026-07-29',
          kcal: 2500,
          hasUnknownValues: false,
          heightPct: (2500 / 2640) * 100,
          hasData: true,
          isOverTarget: true,
          label: '水',
        },
        {
          date: '2026-07-30',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '木',
        },
        {
          date: '2026-07-31',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '金',
        },
        {
          date: '2026-08-01',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '土',
        },
      ],
      targetLinePct: (2200 / 2640) * 100,
      avgRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 2150,
          isUnknown: false,
          target: 2200,
          pct: (2150 / 2200) * 100,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 100,
          isUnknown: false,
          target: 100,
          pct: 100,
          over: false,
        },
      ],
      tableRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 2150,
          isUnknown: false,
          target: 2200,
          pct: (2150 / 2200) * 100,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 100,
          isUnknown: false,
          target: 100,
          pct: 100,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 7,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      daysWithDataCount: 2,
      daysWithUnknownValuesCount: 0,
    })
  })

  it('uses only the target for chart height and shows no target line when no target is set', () => {
    const perDayTotals = new Map([
      ['2026-07-29', { totals: { energy_kcal: 500 }, hasUnknownValues: false }],
    ])
    const periodDates = ['2026-07-29']

    const result = buildReportData(
      periodDates,
      'week',
      perDayTotals,
      DEFINITIONS,
      null,
    )

    expect(result).toEqual({
      rangeText: '7月29日 – 7月29日',
      days: [
        {
          date: '2026-07-29',
          kcal: 500,
          hasUnknownValues: false,
          heightPct: 100,
          hasData: true,
          isOverTarget: false,
          label: '水',
        },
      ],
      targetLinePct: null,
      avgRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 500,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      tableRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 500,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      daysWithDataCount: 1,
      daysWithUnknownValuesCount: 0,
    })
  })

  it('labels a month period every 5th day of month and blanks the rest', () => {
    const result = buildReportData(
      ['2026-07-01', '2026-07-02', '2026-07-05'],
      'month',
      new Map(),
      DEFINITIONS,
      null,
    )

    expect(result).toEqual({
      rangeText: '7月1日 – 7月5日',
      days: [
        {
          date: '2026-07-01',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '',
        },
        {
          date: '2026-07-02',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '',
        },
        {
          date: '2026-07-05',
          kcal: 0,
          hasUnknownValues: false,
          heightPct: 0,
          hasData: false,
          isOverTarget: false,
          label: '5',
        },
      ],
      targetLinePct: null,
      avgRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      tableRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 0,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      daysWithDataCount: 0,
      daysWithUnknownValuesCount: 0,
    })
  })

  it('marks unknown days and excludes them from period averages', () => {
    const result = buildReportData(
      ['2026-07-27', '2026-07-28', '2026-07-29'],
      'week',
      new Map([
        [
          '2026-07-27',
          {
            totals: { energy_kcal: 1000, protein_g: 50, iron_mg: 6 },
            hasUnknownValues: false,
          },
        ],
        [
          '2026-07-28',
          {
            totals: { energy_kcal: 1400, protein_g: 70, iron_mg: 8 },
            hasUnknownValues: true,
          },
        ],
        ['2026-07-29', { totals: {}, hasUnknownValues: true }],
      ]),
      DEFINITIONS,
      null,
    )

    expect(result).toEqual({
      rangeText: '7月27日 – 7月29日',
      days: [
        {
          date: '2026-07-27',
          kcal: 1000,
          heightPct: (1000 / 1400) * 100,
          hasData: true,
          hasUnknownValues: false,
          isOverTarget: false,
          label: '月',
        },
        {
          date: '2026-07-28',
          kcal: 1400,
          heightPct: 100,
          hasData: true,
          hasUnknownValues: true,
          isOverTarget: false,
          label: '火',
        },
        {
          date: '2026-07-29',
          kcal: null,
          heightPct: 0,
          hasData: false,
          hasUnknownValues: true,
          isOverTarget: false,
          label: '水',
        },
      ],
      targetLinePct: null,
      avgRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 1000,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 50,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      tableRows: [
        {
          code: 'energy_kcal',
          label: 'エネルギー',
          unit: 'kcal',
          value: 1000,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'protein_g',
          label: 'たんぱく質',
          unit: 'g',
          value: 50,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
        {
          code: 'iron_mg',
          label: '鉄',
          unit: 'mg',
          value: 6,
          isUnknown: false,
          target: null,
          pct: 0,
          over: false,
        },
      ],
      daysWithDataCount: 1,
      daysWithUnknownValuesCount: 2,
    })
  })
})
