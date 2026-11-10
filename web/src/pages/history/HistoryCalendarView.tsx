import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchMealHistory } from '#api/meal-history'
import { fetchMealPlans } from '#api/meal-plans'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { HistoryCalendar } from '#components/HistoryCalendar/HistoryCalendar'
import { Skeleton } from '#components/Skeleton/Skeleton'
import { shiftMonthString, startOfJstMonth, todayJstDate } from '#lib/jst-date'
import type { CalendarCell } from '#pages/history/build-calendar-cells'
import { buildCalendarCells } from '#pages/history/build-calendar-cells'
import { buildPlannedCountByDate } from '#pages/history/build-planned-counts'

const ENERGY_CODE = 'energy_kcal'
export interface HistoryCalendarViewProps {
  readonly targets: Readonly<Record<string, number>> | null
}

export const HistoryCalendarView = ({
  targets,
}: HistoryCalendarViewProps): React.JSX.Element => {
  const today = todayJstDate()
  const [monthOffset, setMonthOffset] = useState(0)
  const monthStart = shiftMonthString(startOfJstMonth(today), monthOffset)
  const monthEnd = shiftMonthString(monthStart, 1)

  const query = useQuery({
    queryKey: ['meal-history', monthStart, monthEnd],
    queryFn: () => toPromise(fetchMealHistory(monthStart, monthEnd)),
  })
  const mealPlansQuery = useQuery({
    queryKey: ['meal-plans', 'calendar', monthStart, monthEnd],
    queryFn: () => toPromise(fetchMealPlans(monthStart, monthEnd)),
  })

  const energyTarget = targets?.[ENERGY_CODE]
  const kcalByDate = new Map(
    (query.data?.perDay ?? []).map((day) => [
      day.date,
      {
        kcal: day.totals[ENERGY_CODE],
        hasUnknownValues: day.hasUnknownValues,
      },
    ]),
  )
  const plannedCountByDate = buildPlannedCountByDate(
    mealPlansQuery.isError ? [] : (mealPlansQuery.data ?? []),
    today,
  )
  const cells = buildCalendarCells(
    monthStart,
    today,
    kcalByDate,
    energyTarget,
    plannedCountByDate,
  )
  const avgText = formatMonthAverage(cells)

  return (
    <div>
      {query.isError && (
        <ErrorRetry
          onRetry={() => {
            void query.refetch()
          }}
        />
      )}
      {mealPlansQuery.isError && (
        <ErrorRetry
          onRetry={() => {
            void mealPlansQuery.refetch()
          }}
        />
      )}
      {query.isPending && <Skeleton height={340} />}

      {!query.isPending && !query.isError && (
        <HistoryCalendar
          monthStart={monthStart}
          cells={cells}
          averageText={avgText}
          onPreviousMonth={() => {
            setMonthOffset((o) => o - 1)
          }}
          onNextMonth={() => {
            setMonthOffset((o) => o + 1)
          }}
        />
      )}
    </div>
  )
}

const formatMonthAverage = (cells: ReadonlyArray<CalendarCell>): string => {
  const withData = cells.filter(
    (cell) => !cell.hasUnknownValues && cell.kcal !== null && cell.kcal > 0,
  )
  if (withData.length === 0) return '—'
  const sum = withData.reduce((total, c) => total + (c.kcal ?? 0), 0)
  return `${String(Math.round(sum / withData.length))} kcal`
}
