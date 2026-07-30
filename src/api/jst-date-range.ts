import { z } from 'zod'

import { isValidJstCalendarDateString } from '#lib/jst-date'

const JST_OFFSET = '+09:00'
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

// Parses a YYYY-MM-DD calendar date as midnight in Asia/Tokyo into the UTC
// instant callers bind to `periodFrom`/`periodTo`.
const jstCalendarDate = z.string().transform((value, ctx) => {
  if (!DATE_ONLY_RE.test(value)) {
    ctx.addIssue({
      code: 'custom',
      message: `must be a YYYY-MM-DD date, got: ${value}`,
    })
    return z.NEVER
  }
  // `Date` silently rolls an out-of-range day over into the next month
  // (e.g. 2026-02-30 becomes March 2) instead of rejecting it —
  // isValidJstCalendarDateString round-trips through the same conversion to
  // catch that case.
  if (!isValidJstCalendarDateString(value)) {
    ctx.addIssue({
      code: 'custom',
      message: `not a valid calendar date: ${value}`,
    })
    return z.NEVER
  }
  return new Date(`${value}T00:00:00${JST_OFFSET}`)
})

export const jstDateRangeQuerySchema = z.object({
  from: jstCalendarDate,
  to: jstCalendarDate,
})

export type JstDateRangeQuery = z.infer<typeof jstDateRangeQuerySchema>

const DAY_MS = 24 * 60 * 60 * 1000

// Parses a single YYYY-MM-DD path param (e.g. GET /api/days/:date) into the
// [from, to) UTC instant range covering that Asia/Tokyo calendar day.
export const jstDayBoundaryQuerySchema = z
  .object({ date: jstCalendarDate })
  .transform(({ date }) => ({
    from: date,
    to: new Date(date.getTime() + DAY_MS),
  }))

export type JstDayBoundaryQuery = z.infer<typeof jstDayBoundaryQuerySchema>
