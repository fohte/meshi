import { Link } from 'react-router'

import styles from '#components/DayDetailHeader/DayDetailHeader.module.css'
import {
  formatJstMonthDay,
  shiftDateString,
  weekdayLabelJa,
} from '#lib/jst-date'

export interface DayDetailHeaderProps {
  readonly date: string
  readonly dateKind: 'past' | 'today' | 'future'
  readonly entryCount: number | null
}

const MEAL_TYPE_COUNT_LABEL = '品'

export const DayDetailHeader = ({
  date,
  dateKind,
  entryCount,
}: DayDetailHeaderProps): React.JSX.Element => {
  const monthDay = formatJstMonthDay(date)
  const prevDate = shiftDateString(date, -1)
  const nextDate = shiftDateString(date, 1)

  return (
    <header className={styles.header}>
      <div>
        <div className={styles.crumb}>{weekdayLabelJa(date)}曜日</div>
        <h1 className={styles.title}>
          <span className={styles.titleMark}>#</span> {date}
        </h1>
        {entryCount !== null && (
          <div className={styles.subtitle}>
            {dateKind === 'future'
              ? `${monthDay}の予定`
              : `${monthDay}の記録 · ${String(entryCount)} ${MEAL_TYPE_COUNT_LABEL}`}
          </div>
        )}
      </div>
      <nav className={styles.nav}>
        <Link className={styles.navButton} to={`/days/${prevDate}`}>
          ← 前日
        </Link>
        <Link className={styles.navButton} to={`/days/${nextDate}`}>
          翌日 →
        </Link>
        <Link className={styles.navButton} to="/history">
          カレンダー
        </Link>
      </nav>
    </header>
  )
}
