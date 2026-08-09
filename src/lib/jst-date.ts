import { z } from 'zod'

// Asia/Tokyo has no DST, so shifting a UTC instant by a fixed +9h and
// reading its UTC calendar fields gives the exact JST calendar date.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

declare const jstDateBrand: unique symbol

// A YYYY-MM-DD string proven to be a valid JST calendar date — either by
// isValidJstCalendarDateString/jstDateSchema, or by construction
// (toJstDateString/todayJstDateString/nextJstDateString always produce a
// valid one). Every meal_logs.eaten_date/meal_skips.date field in the
// domain layer uses this instead of a plain string.
export type JstDate = string & { readonly [jstDateBrand]: true }

export const toJstDateString = (instant: Date): JstDate => {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- this format string is exactly YYYY-MM-DD by construction; defining the JstDate brand requires asserting it here.
  return `${String(year)}-${month}-${day}` as JstDate
}

// `Date` silently rolls an out-of-range day over into the next month (e.g.
// 2026-02-30 becomes March 2) instead of rejecting it, so round-trip
// through toJstDateString to catch that case.
export const isValidJstCalendarDateString = (
  value: string,
): value is JstDate => {
  if (!DATE_ONLY_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && toJstDateString(date) === value
}

export const todayJstDateString = (now: Date): JstDate => toJstDateString(now)

// Advances a JST calendar date string by one day. Pure calendar arithmetic
// on the date string itself — no instant/timezone conversion, since the
// input is already a JST calendar date.
export const nextJstDateString = (date: JstDate): JstDate => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- toISOString().slice(0, 10) is exactly YYYY-MM-DD by construction; defining the JstDate brand requires asserting it here.
  return d.toISOString().slice(0, 10) as JstDate
}

// The single validating boundary for a JST calendar date coming from
// outside the process (HTTP query/body, MCP tool input, raw SQL row) — every
// call site that used to inline z.string().refine(isValidJstCalendarDateString)
// should use this instead.
export const jstDateSchema = z.string().refine(isValidJstCalendarDateString, {
  message: 'must be a valid YYYY-MM-DD JST calendar date',
})
