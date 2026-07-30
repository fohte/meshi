import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import type { DayDetailEntry, MealType } from '#api/day-detail'
import { fetchDayDetail } from '#api/day-detail'
import { deleteMealSkip, putMealSkip } from '#api/meal-skips'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import {
  fetchNutrientDefinitions,
  NUTRIENT_DEFINITIONS_QUERY_KEY,
} from '#api/nutrient-definitions'
import { fetchUserProfile, PROFILE_QUERY_KEY } from '#api/profile'
import { toPromise } from '#api/to-promise'
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
import { useMealLogSheet } from '#meal-log-sheet/MealLogSheetContext'
import styles from '#pages/DayDetailView.module.css'

export interface DayDetailViewProps {
  readonly date: string
}

export const DayDetailView = ({
  date,
}: DayDetailViewProps): React.JSX.Element => {
  const dayDetailQuery = useQuery({
    queryKey: ['day-detail', date],
    queryFn: () => toPromise(fetchDayDetail(date)),
  })
  const nutrientDefinitionsQuery = useQuery({
    queryKey: NUTRIENT_DEFINITIONS_QUERY_KEY,
    queryFn: () => toPromise(fetchNutrientDefinitions()),
    staleTime: Infinity,
  })
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => toPromise(fetchUserProfile()),
  })

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
  const showNext = date < today
  const weekday = weekdayLabelJa(date)
  const monthDay = formatJstMonthDay(date)

  const crumb = `${weekday}曜日`
  const entryCount = dayDetailQuery.data?.entries.length ?? 0

  return (
    <div>
      <header className={styles.header}>
        <div>
          <div className={styles.crumb}>{crumb}</div>
          <h1 className={styles.title}>
            <span className={styles.titleMark}>#</span> {date}
          </h1>
          {!isPending && !isError && (
            <div className={styles.sub}>
              {monthDay}の記録 · {entryCount} 品
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
          <Link className={styles.navButton} to="/history">
            カレンダー
          </Link>
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
          date={date}
          entries={dayDetailQuery.data.entries}
          totals={dayDetailQuery.data.totals}
          hasEstimatedValues={dayDetailQuery.data.hasEstimatedValues}
          skippedMealTypes={dayDetailQuery.data.skippedMealTypes}
          definitions={nutrientDefinitionsQuery.data}
          targets={profileQuery.data.dailyTargets}
        />
      )}
    </div>
  )
}

interface DayDetailContentProps {
  readonly date: string
  readonly entries: ReadonlyArray<DayDetailEntry>
  readonly totals: Readonly<Record<string, number>>
  readonly hasEstimatedValues: boolean
  readonly skippedMealTypes: ReadonlyArray<MealType>
  readonly definitions: ReadonlyArray<NutrientDefinition>
  readonly targets: Readonly<Record<string, number>> | null
}

const DayDetailContent = ({
  date,
  entries,
  totals,
  hasEstimatedValues,
  skippedMealTypes,
  definitions,
  targets,
}: DayDetailContentProps): React.JSX.Element => {
  const { openEdit } = useMealLogSheet()
  const queryClient = useQueryClient()

  const invalidateDayDetail = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['day-detail'] })
  }

  const markSkippedMutation = useMutation({
    mutationFn: (mealType: MealType) => toPromise(putMealSkip(date, mealType)),
    onSuccess: invalidateDayDetail,
  })
  const cancelSkipMutation = useMutation({
    mutationFn: (mealType: MealType) =>
      toPromise(deleteMealSkip(date, mealType)),
    onSuccess: invalidateDayDetail,
  })

  return (
    <div className={styles.content}>
      <NutritionSummary
        data={buildNutritionSummaryData(totals, definitions, targets)}
        hasEstimatedValues={hasEstimatedValues}
      />
      <MealTimeline
        groups={buildMealTimelineGroups(entries, skippedMealTypes)}
        onItemClick={(id) => {
          const entry = entries.find((e) => e.id === id)
          if (entry !== undefined) openEdit(entry)
        }}
        onMarkSkipped={(mealType) => {
          markSkippedMutation.mutate(mealType)
        }}
        onCancelSkip={(mealType) => {
          cancelSkipMutation.mutate(mealType)
        }}
        isSkipActionPending={
          markSkippedMutation.isPending || cancelSkipMutation.isPending
        }
      />
    </div>
  )
}
