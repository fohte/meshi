import { describe, expect, it } from 'vitest'

import { jstDateRangeQuerySchema } from '#api/jst-date-range'

describe('jstDateRangeQuerySchema', () => {
  it('parses YYYY-MM-DD as a plain JST calendar date string', () => {
    const data = jstDateRangeQuerySchema.parse({
      from: '2026-07-29',
      to: '2026-07-30',
    })
    expect(data).toEqual({
      from: '2026-07-29',
      to: '2026-07-30',
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
