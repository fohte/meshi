import { Result } from 'neverthrow'

// meshi has a single user, always in Japan; every day-view date boundary is
// Asia/Tokyo.
const JST_TIME_ZONE = 'Asia/Tokyo'
const WEEKDAY_LABELS_JA = ['日', '月', '火', '水', '木', '金', '土']

const tryParsePlainDate = Result.fromThrowable((value: string) =>
  Temporal.PlainDate.from(value),
)

export const todayJstDate = (): string =>
  Temporal.Now.plainDateISO(JST_TIME_ZONE).toString()

// dateOnly may be an unvalidated route param (e.g. /days/:date typed by
// hand); an unparseable value yields NaN rather than throwing, same as the
// return-as-is fallback in shiftDateString below.
export const jstWeekdayIndex = (dateOnly: string): number =>
  tryParsePlainDate(dateOnly)
    .map((plainDate) => plainDate.dayOfWeek % 7)
    .unwrapOr(NaN)

export const weekdayLabelJa = (dateOnly: string): string =>
  WEEKDAY_LABELS_JA[jstWeekdayIndex(dateOnly)] ?? ''

// dateOnly may be an unvalidated route param (e.g. /days/:date typed by
// hand), so an unparseable value is returned as-is rather than throwing —
// callers' subsequent API call then surfaces it as a normal 400 error state.
export const shiftDateString = (dateOnly: string, days: number): string =>
  tryParsePlainDate(dateOnly)
    .map((plainDate) => plainDate.add({ days }).toString())
    .unwrapOr(dateOnly)

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

export const shiftMonthString = (monthStart: string, months: number): string =>
  tryParsePlainDate(monthStart)
    .map((plainDate) => plainDate.add({ months }).toString())
    .unwrapOr(monthStart)

export const daysInJstMonth = (monthStart: string): number =>
  tryParsePlainDate(monthStart)
    .map((plainDate) => plainDate.daysInMonth)
    .unwrapOr(NaN)
