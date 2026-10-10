import { daysInJstMonth, jstDateRange, jstWeekdayIndex } from '#lib/jst-date'

type CalendarAchievement = 'none' | 'under' | 'onTarget' | 'over'

export interface CalendarCell {
  readonly date: string | null
  readonly day: number | null
  readonly kcal: number | null
  readonly hasUnknownValues: boolean
  readonly isToday: boolean
  readonly isFuture: boolean
  readonly achievement: CalendarAchievement
}

export interface CalendarDayEnergy {
  readonly kcal: number | undefined
  readonly hasUnknownValues: boolean
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
// energyByDate holds each JST calendar day's known energy and unknown status.
export const buildCalendarCells = (
  monthStart: string,
  today: string,
  energyByDate: ReadonlyMap<string, CalendarDayEnergy>,
  energyTarget: number | undefined,
): readonly CalendarCell[] => {
  const leadingBlanks: CalendarCell[] = Array.from(
    { length: jstWeekdayIndex(monthStart) },
    () => ({
      date: null,
      day: null,
      kcal: null,
      hasUnknownValues: false,
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
    const dayEnergy = energyByDate.get(date)
    const hasUnknownValues = !isFuture && (dayEnergy?.hasUnknownValues ?? false)
    const knownKcal = dayEnergy?.kcal
    const kcal = isFuture ? null : Math.round(knownKcal ?? 0)
    return {
      date,
      day: i + 1,
      kcal:
        isFuture || (hasUnknownValues && knownKcal === undefined) ? null : kcal,
      hasUnknownValues,
      isToday: date === today,
      isFuture,
      achievement:
        isFuture || hasUnknownValues
          ? 'none'
          : achievementFor(kcal ?? 0, energyTarget),
    }
  })

  return [...leadingBlanks, ...days]
}
