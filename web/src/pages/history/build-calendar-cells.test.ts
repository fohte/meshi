import { describe, expect, it } from 'vitest'

import { buildCalendarCells } from '#pages/history/build-calendar-cells'

describe('buildCalendarCells', () => {
  it('builds a full month with leading blanks, today, future, and achievement categories', () => {
    // 2026-07-01 is a Wednesday, so the grid needs 3 leading blank cells.
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-05',
      new Map([
        ['2026-07-01', { kcal: 2400, hasUnknownValues: false }], // over target (target 2000 * 1.1 = 2200)
        ['2026-07-02', { kcal: 1500, hasUnknownValues: false }], // under target (target 2000 * 0.85 = 1700)
        ['2026-07-03', { kcal: 2000, hasUnknownValues: false }], // on target
        ['2026-07-04', { kcal: 0, hasUnknownValues: false }], // no data
        // 2026-07-05 (today) intentionally has no entry either.
      ]),
      2000,
    )

    // Days 6-31 all fall after "today" (2026-07-05), so they're uniformly
    // future/no-data cells — built here rather than the calendar's own
    // future-cell logic, so the assertion below stays a literal, not a
    // second invocation of the code under test.
    const futureDays = Array.from({ length: 26 }, (_, i) => ({
      date: `2026-07-${String(i + 6).padStart(2, '0')}`,
      day: i + 6,
      kcal: null,
      hasUnknownValues: false,
      isToday: false,
      isFuture: true,
      achievement: 'none',
    }))

    expect(cells).toEqual([
      {
        date: null,
        day: null,
        kcal: null,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: null,
        day: null,
        kcal: null,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: null,
        day: null,
        kcal: null,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: '2026-07-01',
        day: 1,
        kcal: 2400,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'over',
      },
      {
        date: '2026-07-02',
        day: 2,
        kcal: 1500,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'under',
      },
      {
        date: '2026-07-03',
        day: 3,
        kcal: 2000,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'onTarget',
      },
      {
        date: '2026-07-04',
        day: 4,
        kcal: 0,
        hasUnknownValues: false,
        isToday: false,
        isFuture: false,
        achievement: 'none',
      },
      {
        date: '2026-07-05',
        day: 5,
        kcal: 0,
        hasUnknownValues: false,
        isToday: true,
        isFuture: false,
        achievement: 'none',
      },
      ...futureDays,
    ])
  })

  it('treats dates after today as future with a null kcal', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-02', { kcal: 9999, hasUnknownValues: false }]]),
      2000,
    )

    const future = cells.find((c) => c.date === '2026-07-02')
    expect(future).toEqual({
      date: '2026-07-02',
      day: 2,
      kcal: null,
      hasUnknownValues: false,
      isToday: false,
      isFuture: true,
      achievement: 'none',
    })
  })

  it('treats a day with data but no target as onTarget rather than over/under', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-01', { kcal: 5000, hasUnknownValues: false }]]),
      undefined,
    )

    expect(cells.find((c) => c.date === '2026-07-01')).toEqual({
      date: '2026-07-01',
      day: 1,
      kcal: 5000,
      hasUnknownValues: false,
      isToday: true,
      isFuture: false,
      achievement: 'onTarget',
    })
  })

  it('keeps unknown-only days visible without treating them as zero kcal', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-01', { kcal: undefined, hasUnknownValues: true }]]),
      2000,
    )

    expect(cells.find((cell) => cell.date === '2026-07-01')).toEqual({
      date: '2026-07-01',
      day: 1,
      kcal: null,
      hasUnknownValues: true,
      isToday: true,
      isFuture: false,
      achievement: 'none',
    })
  })

  it('shows a known lower bound without assigning an achievement when the day has unknown foods', () => {
    const cells = buildCalendarCells(
      '2026-07-01',
      '2026-07-01',
      new Map([['2026-07-01', { kcal: 900, hasUnknownValues: true }]]),
      2000,
    )

    expect(cells.find((cell) => cell.date === '2026-07-01')).toEqual({
      date: '2026-07-01',
      day: 1,
      kcal: 900,
      hasUnknownValues: true,
      isToday: true,
      isFuture: false,
      achievement: 'none',
    })
  })
})
