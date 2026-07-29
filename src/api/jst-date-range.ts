import { z } from 'zod'

const JST_OFFSET = '+09:00'
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

// Asia/Tokyo has no DST, so shifting a UTC instant by a fixed +9h and
// reading its UTC calendar fields gives the exact JST calendar date (same
// technique as src/domain/meal-log/infer-meal-type.ts).
const toJstDateString = (instant: Date): string => {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

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
  const date = new Date(`${value}T00:00:00${JST_OFFSET}`)
  // `Date` silently rolls an out-of-range day over into the next month
  // (e.g. 2026-02-30 becomes March 2) instead of rejecting it, so round-trip
  // through the same conversion to catch that case.
  if (Number.isNaN(date.getTime()) || toJstDateString(date) !== value) {
    ctx.addIssue({
      code: 'custom',
      message: `not a valid calendar date: ${value}`,
    })
    return z.NEVER
  }
  return date
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
