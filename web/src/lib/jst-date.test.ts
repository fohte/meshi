import { describe, expect, it } from 'vitest'

import {
  daysInJstMonth,
  formatJstDate,
  formatJstMonthDay,
  formatJstTime,
  formatJstYearMonth,
  jstDateOf,
  jstDateRange,
  jstWallClockToIsoInstant,
  jstWeekdayIndex,
  shiftDateString,
  shiftMonthString,
  startOfJstMonth,
  weekdayLabelJa,
} from '#lib/jst-date'

describe('formatJstTime', () => {
  it('formats a UTC instant as its JST HH:MM wall-clock time', () => {
    expect(formatJstTime('2026-07-28T23:05:00.000Z')).toBe('08:05')
  })

  it('rolls over the JST hour past midnight UTC', () => {
    expect(formatJstTime('2026-07-29T15:30:00.000Z')).toBe('00:30')
  })
})

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

describe('jstDateOf', () => {
  it('returns the JST calendar date a UTC instant falls on', () => {
    expect(jstDateOf('2026-07-28T23:05:00.000Z')).toBe('2026-07-29')
  })

  it('rolls over to the next JST day past 15:00 UTC', () => {
    expect(jstDateOf('2026-07-29T15:30:00.000Z')).toBe('2026-07-30')
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
})

describe('formatJstDate', () => {
  it('formats a UTC instant as its JST calendar date', () => {
    expect(formatJstDate('2026-07-28T23:05:00.000Z')).toBe('2026-07-29')
  })

  it('rolls over the JST date past midnight UTC', () => {
    expect(formatJstDate('2026-07-29T15:30:00.000Z')).toBe('2026-07-30')
  })
})

describe('jstWallClockToIsoInstant', () => {
  it('converts a JST date + time back to a UTC instant', () => {
    expect(jstWallClockToIsoInstant('2026-07-29', '08:05')).toBe(
      '2026-07-28T23:05:00.000Z',
    )
  })
})
