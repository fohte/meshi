import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  fetchNutrientDefinitions,
  NUTRIENT_DEFINITIONS_QUERY_KEY,
} from '#api/nutrient-definitions'
import { fetchUserProfile, PROFILE_QUERY_KEY } from '#api/profile'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { Skeleton } from '#components/Skeleton/Skeleton'
import { HistoryCalendarView } from '#pages/history/HistoryCalendarView'
import { HistoryListView } from '#pages/history/HistoryListView'
import { HistoryReportView } from '#pages/history/HistoryReportView'
import styles from '#pages/HistoryPage.module.css'

const HISTORY_VIEWS = [
  ['calendar', 'カレンダー'],
  ['list', 'リスト'],
  ['report', 'レポート'],
] as const

type HistoryViewName = (typeof HISTORY_VIEWS)[number][0]

export const HistoryPage = (): React.JSX.Element => {
  const [view, setView] = useState<HistoryViewName>('calendar')

  const nutrientDefinitionsQuery = useQuery({
    queryKey: NUTRIENT_DEFINITIONS_QUERY_KEY,
    queryFn: () => toPromise(fetchNutrientDefinitions()),
    staleTime: Infinity,
  })
  const profileQuery = useQuery({
    queryKey: PROFILE_QUERY_KEY,
    queryFn: () => toPromise(fetchUserProfile()),
  })

  const isPending = nutrientDefinitionsQuery.isPending || profileQuery.isPending
  const isError = nutrientDefinitionsQuery.isError || profileQuery.isError

  const retry = (): void => {
    void nutrientDefinitionsQuery.refetch()
    void profileQuery.refetch()
  }

  return (
    <div>
      <h1 className={styles.heading}>
        <span className={styles.hash}>#</span> 履歴
      </h1>
      <div className={styles.tabs}>
        {HISTORY_VIEWS.map(([name, label]) => (
          <button
            key={name}
            type="button"
            className={styles.tab}
            data-active={view === name ? '' : undefined}
            onClick={() => {
              setView(name)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {isError && <ErrorRetry onRetry={retry} />}

      {isPending && !isError && (
        <div className={styles.skeletonStack}>
          <Skeleton height={320} />
        </div>
      )}

      {!isPending && !isError && (
        <>
          {view === 'calendar' && (
            <HistoryCalendarView targets={profileQuery.data.dailyTargets} />
          )}
          {view === 'list' && (
            <HistoryListView targets={profileQuery.data.dailyTargets} />
          )}
          {view === 'report' && (
            <HistoryReportView
              definitions={nutrientDefinitionsQuery.data}
              targets={profileQuery.data.dailyTargets}
            />
          )}
        </>
      )}
    </div>
  )
}
