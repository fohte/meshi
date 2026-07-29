import { describe, expect, it } from 'vitest'

import { buildCalendarCells } from '#pages/history/build-calendar-cells'

describe('buildCalendarCells', () => {
  it('builds a full month with leading blanks, today, future, and achievement categories', () => {
    // 2026-07-01 is a Wednesday, so the grid needs 3 leading blank cells.
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-05',
      new Map([
        ['2026-07-01', 2400], // over target (target 2000 * 1.1 = 2200)
        ['2026-07-02', 1500], // under target (target 2000 * 0.85 = 1700)
        ['2026-07-03', 2000], // on target
        ['2026-07-04', 0], // no data
        // 2026-07-05 (today) intentionally has no entry either.
      ]),
      2000,
    )

    expect(cells.slice(0, 8)).toEqual([
      {
        date: null,
        day: null,
        kcal: null,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: null,
        day: null,
        kcal: null,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: null,
        day: null,
        kcal: null,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: '2026-07-01',
        day: 1,
        kcal: 2400,
        isToday: false,
        isFuture: false,
        achievement: 'over',
      },
      {
        date: '2026-07-02',
        day: 2,
        kcal: 1500,
        isToday: false,
        isFuture: false,
        achievement: 'under',
      },
      {
        date: '2026-07-03',
        day: 3,
        kcal: 2000,
        isToday: false,
        isFuture: false,
        achievement: 'onTarget',
      },
      {
        date: '2026-07-04',
        day: 4,
        kcal: 0,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: '2026-07-05',
        day: 5,
        kcal: 0,
        isToday: true,
        isFuture: false,
        achievement: 'none',
      },
    ])
    // 3 leading blanks + 31 days in July.
    expect(cells).toHaveLength(34)
  })

  it('treats dates after today as future with a null kcal', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-02', 9999]]),
      2000,
    )

    const future = cells.find((c) => c.date === '2026-07-02')
    expect(future).toEqual({
      date: '2026-07-02',
      day: 2,
      kcal: null,
      isToday: false,
      isFuture: true,
      achievement: 'none',
    })
  })

  it('treats a day with data but no target as onTarget rather than over/under', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-01', 5000]]),
      undefined,
    )

    expect(cells.find((c) => c.date === '2026-07-01')?.achievement).toBe(
      'onTarget',
    )
  })
})
