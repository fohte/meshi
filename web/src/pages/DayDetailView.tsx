import { Link } from 'react-router'

import type { DayDetailEntry } from '#api/day-detail'
import { useDayDetail } from '#api/day-detail'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import { useNutrientDefinitions } from '#api/nutrient-definitions'
import { useProfile } from '#api/profile'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'
import { MealTimeline } from '#components/MealTimeline/MealTimeline'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { NutritionSummary } from '#components/NutritionSummary/NutritionSummary'
import { Skeleton } from '#components/Skeleton/Skeleton'
import {
  formatJstMonthDay,
  shiftDateString,
  todayJstDate,
  weekdayLabelJa,
} from '#lib/jst-date'
import styles from '#pages/DayDetailView.module.css'

export interface DayDetailViewProps {
  readonly date: string
  readonly variant: 'today' | 'day'
}

export const DayDetailView = ({
  date,
  variant,
}: DayDetailViewProps): React.JSX.Element => {
  const dayDetailQuery = useDayDetail(date)
  const nutrientDefinitionsQuery = useNutrientDefinitions()
  const profileQuery = useProfile()

  const isPending =
    dayDetailQuery.isPending ||
    nutrientDefinitionsQuery.isPending ||
    profileQuery.isPending
  const isError =
    dayDetailQuery.isError ||
    nutrientDefinitionsQuery.isError ||
    profileQuery.isError

  const retry = (): void => {
    void dayDetailQuery.refetch()
    void nutrientDefinitionsQuery.refetch()
    void profileQuery.refetch()
  }

  const today = todayJstDate()
  const prevDate = shiftDateString(date, -1)
  const nextDate = shiftDateString(date, 1)
  const showNext = variant === 'day' && date < today
  const weekday = weekdayLabelJa(date)
  const monthDay = formatJstMonthDay(date)

  const crumb = variant === 'today' ? 'TODAY' : `${weekday}曜日`
  const title = variant === 'today' ? `${monthDay} (${weekday})` : date
  const entryCount = dayDetailQuery.data?.entries.length ?? 0

  return (
    <div>
      <header className={styles.header}>
        <div>
          <div className={styles.crumb}>{crumb}</div>
          <h1 className={styles.title}>
            <span className={styles.titleMark}>#</span> {title}
          </h1>
          {!isPending && !isError && (
            <div className={styles.sub}>
              {variant === 'today' ? '今日の記録' : `${monthDay}の記録`} ·{' '}
              {entryCount} 品
            </div>
          )}
        </div>
        <nav className={styles.nav}>
          <Link className={styles.navButton} to={`/days/${prevDate}`}>
            ← 前日
          </Link>
          {showNext && (
            <Link className={styles.navButton} to={`/days/${nextDate}`}>
              翌日 →
            </Link>
          )}
          {variant === 'day' && (
            <Link className={styles.navButton} to="/history">
              カレンダー
            </Link>
          )}
        </nav>
      </header>

      {isError && <ErrorRetry onRetry={retry} />}

      {isPending && !isError && (
        <div className={styles.skeletonStack}>
          <Skeleton height={220} />
          <Skeleton height={140} />
        </div>
      )}

      {!isPending && !isError && (
        <DayDetailContent
          entries={dayDetailQuery.data.entries}
          totals={dayDetailQuery.data.totals}
          hasEstimatedValues={dayDetailQuery.data.hasEstimatedValues}
          definitions={nutrientDefinitionsQuery.data}
          targets={profileQuery.data.dailyTargets}
          emptyText={
            variant === 'today'
              ? '今日の記録はまだありません'
              : 'この日の記録はありません'
          }
        />
      )}
    </div>
  )
}

interface DayDetailContentProps {
  readonly entries: ReadonlyArray<DayDetailEntry>
  readonly totals: Readonly<Record<string, number>>
  readonly hasEstimatedValues: boolean
  readonly definitions: ReadonlyArray<NutrientDefinition>
  readonly targets: Readonly<Record<string, number>> | null
  readonly emptyText: string
}

const DayDetailContent = ({
  entries,
  totals,
  hasEstimatedValues,
  definitions,
  targets,
  emptyText,
}: DayDetailContentProps): React.JSX.Element => {
  if (entries.length === 0) {
    return (
      <div className={styles.emptyState}>
        <div className={styles.emptyText}>{emptyText}</div>
        <button type="button" className={styles.emptyCreateButton}>
          + 記録する
        </button>
      </div>
    )
  }

  return (
    <div className={styles.content}>
      <NutritionSummary
        data={buildNutritionSummaryData(totals, definitions, targets)}
        hasEstimatedValues={hasEstimatedValues}
      />
      <MealTimeline groups={buildMealTimelineGroups(entries)} />
    </div>
  )
}
