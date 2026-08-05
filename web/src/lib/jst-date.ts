// meshi has a single user, always in Japan; every day-view date boundary is
// Asia/Tokyo. Asia/Tokyo has no DST, so shifting a UTC instant by a fixed
// +9h and reading its UTC calendar/clock fields gives the exact JST wall
// clock (same technique as the backend's src/domain/meal-log/infer-meal-type.ts).
const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土']

const pad2 = (n: number): string => String(n).padStart(2, '0')

const toJstParts = (
  instant: Date,
): {
  year: number
  month: number
  day: number
  hours: number
  minutes: number
  weekday: number
} => {
  const shifted = new Date(instant.getTime() + JST_OFFSET_MS)
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    weekday: shifted.getUTCDay(),
  }
}

export const todayJstDate = (): string => {
  const { year, month, day } = toJstParts(new Date())
  return `${String(year)}-${pad2(month)}-${pad2(day)}`
}

// isoDateTime is a UTC ISO instant; returns the YYYY-MM-DD calendar date it
// falls on in JST (e.g. to group meal-history entries by JST day).
export const jstDateOf = (isoDateTime: string): string => {
  const { year, month, day } = toJstParts(new Date(isoDateTime))
  return `${String(year)}-${pad2(month)}-${pad2(day)}`
}

// dateOnly is a YYYY-MM-DD calendar date (already a JST date, not an
// instant needing conversion), so this reads its fields directly rather
// than going through toJstParts.
export const jstWeekdayIndex = (dateOnly: string): number =>
  new Date(`${dateOnly}T00:00:00Z`).getUTCDay()

export const weekdayLabelJa = (dateOnly: string): string =>
  WEEKDAY_LABELS_JA[jstWeekdayIndex(dateOnly)] ?? ''

// dateOnly may be an unvalidated route param (e.g. /days/:date typed by
// hand), so an unparseable value is returned as-is rather than throwing —
// callers' subsequent API call then surfaces it as a normal 400 error state.
export const shiftDateString = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return dateOnly
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Returns `count` consecutive calendar dates starting at `start`, ascending.
export const jstDateRange = (start: string, count: number): readonly string[] =>
  Array.from({ length: count }, (_, i) => shiftDateString(start, i))

export const formatJstMonthDay = (dateOnly: string): string => {
  const month = Number(dateOnly.slice(5, 7))
  const day = Number(dateOnly.slice(8, 10))
  return `${String(month)}月${String(day)}日`
}

export const formatJstYearMonth = (monthStart: string): string => {
  const year = Number(monthStart.slice(0, 4))
  const month = Number(monthStart.slice(5, 7))
  return `${String(year)}年${String(month)}月`
}

// dateOnly may be any day within the month; returns that month's first day.
export const startOfJstMonth = (dateOnly: string): string =>
  `${dateOnly.slice(0, 7)}-01`

// monthStart must be a month's first day (e.g. from startOfJstMonth).
export const shiftMonthString = (
  monthStart: string,
  months: number,
): string => {
  const d = new Date(`${monthStart}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

// monthStart must be a month's first day (e.g. from startOfJstMonth).
export const daysInJstMonth = (monthStart: string): number => {
  const d = new Date(`${monthStart}T00:00:00Z`)
  d.setUTCMonth(d.getUTCMonth() + 1)
  d.setUTCDate(0)
  return d.getUTCDate()
}

// isoDateTime is a UTC instant; returns its JST calendar date as YYYY-MM-DD.
export const formatJstDate = (isoDateTime: string): string => {
  const { year, month, day } = toJstParts(new Date(isoDateTime))
  return `${String(year)}-${pad2(month)}-${pad2(day)}`
}
