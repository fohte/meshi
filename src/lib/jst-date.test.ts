import { describe, expect, it } from 'vitest'

import { isValidJstCalendarDateString, todayJstDateString } from '#lib/jst-date'

describe('isValidJstCalendarDateString', () => {
  it('accepts a valid YYYY-MM-DD date', () => {
    expect(isValidJstCalendarDateString('2026-07-30')).toBe(true)
  })

  it('rejects a non YYYY-MM-DD format', () => {
    expect(isValidJstCalendarDateString('2026/07/30')).toBe(false)
  })

  it('rejects a calendar date that does not exist', () => {
    expect(isValidJstCalendarDateString('2026-02-30')).toBe(false)
  })
})

describe('todayJstDateString', () => {
  it('shifts a UTC instant across the JST day boundary', () => {
    expect(todayJstDateString(new Date('2026-07-29T15:00:00Z'))).toBe(
      '2026-07-30',
    )
  })
})
