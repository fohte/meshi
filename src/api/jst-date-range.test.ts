import { describe, expect, it } from 'vitest'

import {
  jstDateRangeQuerySchema,
  jstDayBoundaryQuerySchema,
} from '#api/jst-date-range'

describe('jstDateRangeQuerySchema', () => {
  it('parses YYYY-MM-DD as midnight Asia/Tokyo converted to a UTC instant', () => {
    const data = jstDateRangeQuerySchema.parse({
      from: '2026-07-29',
      to: '2026-07-30',
    })
    expect(data).toEqual({
      from: new Date('2026-07-28T15:00:00.000Z'),
      to: new Date('2026-07-29T15:00:00.000Z'),
    })
  })

  it('rejects a non YYYY-MM-DD format', () => {
    expect(() =>
      jstDateRangeQuerySchema.parse({ from: '2026/07/29', to: '2026-07-30' }),
    ).toThrow()
  })

  it('rejects a calendar date that does not exist', () => {
    expect(() =>
      jstDateRangeQuerySchema.parse({ from: '2026-02-30', to: '2026-03-01' }),
    ).toThrow()
  })

  it('rejects when from or to is missing', () => {
    expect(() =>
      jstDateRangeQuerySchema.parse({ from: '2026-07-29' }),
    ).toThrow()
  })
})

describe('jstDayBoundaryQuerySchema', () => {
  it('parses a single YYYY-MM-DD into a [from, to) 24h UTC range', () => {
    const data = jstDayBoundaryQuerySchema.parse({ date: '2026-07-29' })
    expect(data).toEqual({
      from: new Date('2026-07-28T15:00:00.000Z'),
      to: new Date('2026-07-29T15:00:00.000Z'),
    })
  })

  it('rejects a non YYYY-MM-DD format', () => {
    expect(() =>
      jstDayBoundaryQuerySchema.parse({ date: '2026/07/29' }),
    ).toThrow()
  })

  it('rejects a calendar date that does not exist', () => {
    expect(() =>
      jstDayBoundaryQuerySchema.parse({ date: '2026-02-30' }),
    ).toThrow()
  })
})
