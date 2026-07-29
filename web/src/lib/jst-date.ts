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

// eatenAt is a UTC ISO instant; formats its JST wall-clock time as HH:MM.
export const formatJstTime = (isoDateTime: string): string => {
  const { hours, minutes } = toJstParts(new Date(isoDateTime))
  return `${pad2(hours)}:${pad2(minutes)}`
}

// dateOnly is a YYYY-MM-DD calendar date (already a JST date, not an
// instant needing conversion), so this reads its fields directly rather
// than going through toJstParts.
export const weekdayLabelJa = (dateOnly: string): string => {
  const weekday = new Date(`${dateOnly}T00:00:00Z`).getUTCDay()
  return WEEKDAY_LABELS_JA[weekday] ?? ''
}

export const shiftDateString = (dateOnly: string, days: number): string => {
  const d = new Date(`${dateOnly}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export const formatJstMonthDay = (dateOnly: string): string => {
  const month = Number(dateOnly.slice(5, 7))
  const day = Number(dateOnly.slice(8, 10))
  return `${String(month)}月${String(day)}日`
}
