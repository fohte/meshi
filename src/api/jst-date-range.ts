import { z } from 'zod'

import { isValidJstCalendarDateString } from '#lib/jst-date'

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

// Validates a YYYY-MM-DD calendar date and passes it through unchanged —
// meal_logs.eaten_date is a plain JST calendar date, not a UTC instant.
export const jstCalendarDateSchema = z.string().transform((value, ctx) => {
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
  return value
})

export const jstDateRangeQuerySchema = z.object({
  from: jstCalendarDateSchema,
  to: jstCalendarDateSchema,
})

export type JstDateRangeQuery = z.infer<typeof jstDateRangeQuerySchema>
