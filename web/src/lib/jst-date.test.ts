import { describe, expect, it } from 'vitest'

import {
  daysInJstMonth,
  formatJstMonthDay,
  formatJstYearMonth,
  jstDateRange,
  jstWeekdayIndex,
  shiftDateString,
  shiftMonthString,
  startOfJstMonth,
  weekdayLabelJa,
} from '#lib/jst-date'

describe('weekdayLabelJa', () => {
  it('returns the Japanese weekday label for a calendar date', () => {
    // 2026-07-29 is a Wednesday.
    expect(weekdayLabelJa('2026-07-29')).toBe('水')
  })
})

describe('shiftDateString', () => {
  it('shifts a calendar date forward', () => {
    expect(shiftDateString('2026-07-29', 1)).toBe('2026-07-30')
  })

  it('shifts a calendar date backward across a month boundary', () => {
    expect(shiftDateString('2026-08-01', -1)).toBe('2026-07-31')
  })

  it('returns an unparseable date unchanged instead of throwing', () => {
    expect(shiftDateString('not-a-date', 1)).toBe('not-a-date')
  })
})

describe('formatJstMonthDay', () => {
  it('formats without zero-padding', () => {
    expect(formatJstMonthDay('2026-07-05')).toBe('7月5日')
  })
})

describe('jstWeekdayIndex', () => {
  it('returns the numeric weekday index for a calendar date', () => {
    // 2026-07-29 is a Wednesday.
    expect(jstWeekdayIndex('2026-07-29')).toBe(3)
  })
})

describe('jstDateRange', () => {
  it('returns count consecutive ascending calendar dates starting at start', () => {
    expect(jstDateRange('2026-07-29', 3)).toEqual([
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
    ])
  })
})

describe('formatJstYearMonth', () => {
  it('formats a month start as YYYY年M月', () => {
    expect(formatJstYearMonth('2026-07-01')).toBe('2026年7月')
  })
})

describe('startOfJstMonth', () => {
  it('returns the first day of the month containing the given date', () => {
    expect(startOfJstMonth('2026-07-29')).toBe('2026-07-01')
  })
})

describe('shiftMonthString', () => {
  it('shifts a month start forward', () => {
    expect(shiftMonthString('2026-07-01', 1)).toBe('2026-08-01')
  })

  it('shifts a month start backward across a year boundary', () => {
    expect(shiftMonthString('2026-01-01', -1)).toBe('2025-12-01')
  })

  it('constrains a month-end overflow into the shorter target month instead of overflowing', () => {
    expect(shiftMonthString('2026-01-31', 1)).toBe('2026-02-28')
  })
})

describe('daysInJstMonth', () => {
  it('returns 31 for July', () => {
    expect(daysInJstMonth('2026-07-01')).toBe(31)
  })

  it('returns 28 for a non-leap February', () => {
    expect(daysInJstMonth('2026-02-01')).toBe(28)
  })

  it('returns 29 for a leap February', () => {
    expect(daysInJstMonth('2028-02-01')).toBe(29)
  })

  it('returns the same result for a mid-month date as for the month start', () => {
    expect(daysInJstMonth('2026-02-15')).toBe(28)
  })
})
