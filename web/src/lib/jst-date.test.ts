import { describe, expect, it } from 'vitest'

import {
  formatJstDate,
  formatJstMonthDay,
  formatJstTime,
  jstWallClockToIsoInstant,
  shiftDateString,
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
