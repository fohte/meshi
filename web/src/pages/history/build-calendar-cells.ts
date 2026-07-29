import { daysInJstMonth, jstDateRange, jstWeekdayIndex } from '#lib/jst-date'

export type CalendarAchievement = 'none' | 'under' | 'onTarget' | 'over'

export interface CalendarCell {
  readonly date: string | null
  readonly day: number | null
  readonly kcal: number | null
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly achievement: CalendarAchievement
}

const OVER_TARGET_RATIO = 1.1
const UNDER_TARGET_RATIO = 0.85

const achievementFor = (
  kcal: number,
  target: number | undefined,
): CalendarAchievement => {
  if (kcal <= 0) return 'none'
  if (target === undefined || target <= 0) return 'onTarget'
  if (kcal > target * OVER_TARGET_RATIO) return 'over'
  if (kcal < target * UNDER_TARGET_RATIO) return 'under'
  return 'onTarget'
}

// monthStart must be a month's first day (e.g. from startOfJstMonth).
// kcalByDate holds each JST calendar day's total energy_kcal.
export const buildCalendarCells = (
  monthStart: string,
  today: string,
  kcalByDate: ReadonlyMap<string, number>,
  energyTarget: number | undefined,
): readonly CalendarCell[] => {
  const leadingBlanks: CalendarCell[] = Array.from(
    { length: jstWeekdayIndex(monthStart) },
    () => ({
      date: null,
      day: null,
      kcal: null,
      isToday: false,
      isFuture: false,
      achievement: 'none',
    }),
  )

  const days: CalendarCell[] = jstDateRange(
    monthStart,
    daysInJstMonth(monthStart),
  ).map((date, i) => {
    const isFuture = date > today
    const kcal = isFuture ? 0 : Math.round(kcalByDate.get(date) ?? 0)
    return {
      date,
      day: i + 1,
      kcal: isFuture ? null : kcal,
      isToday: date === today,
      isFuture,
      achievement: achievementFor(kcal, energyTarget),
    }
  })

  return [...leadingBlanks, ...days]
}
