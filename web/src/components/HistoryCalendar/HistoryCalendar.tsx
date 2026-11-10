import { Link } from 'react-router'

import styles from '#components/HistoryCalendar/HistoryCalendar.module.css'
import { formatJstYearMonth } from '#lib/jst-date'
import type { CalendarCell } from '#pages/history/build-calendar-cells'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

export interface HistoryCalendarProps {
  readonly monthStart: string
  readonly cells: ReadonlyArray<CalendarCell>
  readonly averageText: string
  readonly onPreviousMonth: () => void
  readonly onNextMonth: () => void
}

export const HistoryCalendar = ({
  monthStart,
  cells,
  averageText,
  onPreviousMonth,
  onNextMonth,
}: HistoryCalendarProps): React.JSX.Element => (
  <>
    <div className={styles.nav}>
      <button
        type="button"
        className={styles.navButton}
        onClick={onPreviousMonth}
      >
        ←
      </button>
      <div className={styles.title}>{formatJstYearMonth(monthStart)}</div>
      <button type="button" className={styles.navButton} onClick={onNextMonth}>
        →
      </button>
      <div className={styles.avg}>月平均 {averageText}</div>
    </div>

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
)

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
      <Link to={`/days/${cell.date}`} className={styles.cell} data-future="">
        <span className={styles.day}>{cell.day}</span>
        {cell.plannedCount > 0 && (
          <span className={styles.planCount}>予定 {cell.plannedCount}</span>
        )}
      </Link>
    )
  }

  return (
    <Link
      to={`/days/${cell.date}`}
      className={styles.cell}
      data-today={cell.isToday ? '' : undefined}
    >
      <span className={styles.day}>{cell.day}</span>
      <span
        className={styles.kcal}
        data-achievement={cell.achievement}
        title={
          cell.hasUnknownValues
            ? '栄養値不明の食事を含み、合計は下限です'
            : undefined
        }
      >
        {cell.hasUnknownValues
          ? cell.kcal === null
            ? '不明'
            : `≥${String(cell.kcal)}`
          : cell.kcal !== null && cell.kcal > 0
            ? cell.kcal
            : ''}
      </span>
      <span className={styles.dot} data-achievement={cell.achievement} />
    </Link>
  )
}
