// Asia/Tokyo has no DST, so shifting a UTC instant by a fixed +9h and
// reading its UTC calendar fields gives the exact JST calendar date.
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/

export const toJstDateString = (instant: Date): string => {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS)
  const year = shifted.getUTCFullYear()
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

// `Date` silently rolls an out-of-range day over into the next month (e.g.
// 2026-02-30 becomes March 2) instead of rejecting it, so round-trip
// through toJstDateString to catch that case.
export const isValidJstCalendarDateString = (value: string): boolean => {
  if (!DATE_ONLY_RE.test(value)) return false
  const date = new Date(`${value}T00:00:00+09:00`)
  return !Number.isNaN(date.getTime()) && toJstDateString(date) === value
}

export const todayJstDateString = (now: Date): string => toJstDateString(now)
