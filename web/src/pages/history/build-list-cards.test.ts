import { describe, expect, it } from 'vitest'

import { buildListCards } from '#pages/history/build-list-cards'

describe('buildListCards', () => {
  it('builds newest-first cards summarizing food names, meta, kcal, and target pct', () => {
    const cards = buildListCards(
      [
        {
          date: '2026-07-28',
          totals: { energy_kcal: 1800, salt_g: 6.2 },
        },
        {
          date: '2026-07-29',
          totals: { energy_kcal: 2500, salt_g: 8.1 },
        },
      ],
      new Map([
        ['2026-07-28', ['ごはん', '卵']],
        ['2026-07-29', ['ラーメン', 'サラダ', 'コーヒー', 'バナナ']],
      ]),
      2200,
    )

    expect(cards).toEqual([
      {
        date: '2026-07-29',
        dayText: '7/29',
        dowText: '水',
        summary: 'ラーメン、サラダ ほか 2 品',
        metaText: '4 品 · 塩分 8.1 g',
        kcalText: '2500 kcal',
        pctText: '114%',
        isOverTarget: true,
      },
      {
        date: '2026-07-28',
        dayText: '7/28',
        dowText: '火',
        summary: 'ごはん、卵',
        metaText: '2 品 · 塩分 6.2 g',
        kcalText: '1800 kcal',
        pctText: '82%',
        isOverTarget: false,
      },
    ])
  })

  it('shows a dash for pct and never marks over-target when no energy target is set', () => {
    const cards = buildListCards(
      [{ date: '2026-07-29', totals: { energy_kcal: 3000 } }],
      new Map([['2026-07-29', ['ラーメン']]]),
      undefined,
    )

    expect(cards).toEqual([
      {
        date: '2026-07-29',
        dayText: '7/29',
        dowText: '水',
        summary: 'ラーメン',
        metaText: '1 品 · 塩分 0.0 g',
        kcalText: '3000 kcal',
        pctText: '—',
        isOverTarget: false,
      },
    ])
  })

  it('falls back to a no-records summary when no food names are known for a day', () => {
    const cards = buildListCards(
      [{ date: '2026-07-29', totals: { energy_kcal: 0 } }],
      new Map(),
      2200,
    )

    expect(cards).toEqual([
      {
        date: '2026-07-29',
        dayText: '7/29',
        dowText: '水',
        summary: '記録なし',
        metaText: '0 品 · 塩分 0.0 g',
        kcalText: '0 kcal',
        pctText: '0%',
        isOverTarget: false,
      },
    ])
  })
})
