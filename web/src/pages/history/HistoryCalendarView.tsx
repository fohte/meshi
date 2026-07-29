import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'

import { fetchMealHistory } from '#api/meal-history'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { Skeleton } from '#components/Skeleton/Skeleton'
import {
  formatJstYearMonth,
  shiftMonthString,
  startOfJstMonth,
  todayJstDate,
} from '#lib/jst-date'
import type { CalendarCell } from '#pages/history/build-calendar-cells'
import { buildCalendarCells } from '#pages/history/build-calendar-cells'
import styles from '#pages/history/HistoryCalendarView.module.css'

const ENERGY_CODE = 'energy_kcal'
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

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

  const energyTarget = targets?.[ENERGY_CODE]
  const kcalByDate = new Map(
    (query.data?.perDay ?? []).map((d) => [d.date, d.totals[ENERGY_CODE] ?? 0]),
  )
  const cells = buildCalendarCells(monthStart, today, kcalByDate, energyTarget)
  const avgText = formatMonthAverage(cells)

  return (
    <div>
      <div className={styles.nav}>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => {
            setMonthOffset((o) => o - 1)
          }}
        >
          ←
        </button>
        <div className={styles.title}>{formatJstYearMonth(monthStart)}</div>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => {
            setMonthOffset((o) => o + 1)
          }}
        >
          →
        </button>
        <div className={styles.avg}>月平均 {avgText}</div>
      </div>

      {query.isError && (
        <ErrorRetry
          onRetry={() => {
            void query.refetch()
          }}
        />
      )}
      {query.isPending && <Skeleton height={340} />}

      {!query.isPending && !query.isError && (
        <>
          <div className={styles.grid}>
            {WEEKDAY_LABELS.map((label, i) => (
              <div
                key={label}
                className={styles.dow}
                data-weekend={i === 0 || i === 6 ? '' : undefined}
              >
                {label}
              </div>
            ))}
            {cells.map((cell, i) => (
              <CalendarCellButton
                key={cell.date ?? `blank-${String(i)}`}
                cell={cell}
              />
            ))}
          </div>
          <div className={styles.legend}>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-achievement="under" />
              目標未達
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-achievement="onTarget" />
              目標付近
            </span>
            <span className={styles.legendItem}>
              <span className={styles.legendDot} data-achievement="over" />
              超過
            </span>
          </div>
        </>
      )}
    </div>
  )
}

const formatMonthAverage = (cells: ReadonlyArray<CalendarCell>): string => {
  const withData = cells.filter((c) => c.kcal !== null && c.kcal > 0)
  if (withData.length === 0) return '—'
  const sum = withData.reduce((total, c) => total + (c.kcal ?? 0), 0)
  return `${String(Math.round(sum / withData.length))} kcal`
}

interface CalendarCellButtonProps {
  readonly cell: CalendarCell
}

const CalendarCellButton = ({
  cell,
}: CalendarCellButtonProps): React.JSX.Element => {
  if (cell.date === null) {
    return <div className={styles.cell} />
  }

  if (cell.isFuture) {
    return (
      <div className={styles.cell} data-future="">
        <span className={styles.day}>{cell.day}</span>
      </div>
    )
  }

  return (
    <Link
      to={`/days/${cell.date}`}
      className={styles.cell}
      data-today={cell.isToday ? '' : undefined}
    >
      <span className={styles.day}>{cell.day}</span>
      <span className={styles.kcal} data-achievement={cell.achievement}>
        {cell.kcal !== null && cell.kcal > 0 ? cell.kcal : ''}
      </span>
      <span className={styles.dot} data-achievement={cell.achievement} />
    </Link>
  )
}
