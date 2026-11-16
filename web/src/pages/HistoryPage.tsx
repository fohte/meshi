import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import {
  fetchNutrientDefinitions,
  NUTRIENT_DEFINITIONS_QUERY_KEY,
} from '#api/nutrient-definitions'
import { fetchUserProfile, PROFILE_QUERY_KEY } from '#api/profile'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import {
  HistoryTabs,
  type HistoryViewName,
} from '#components/HistoryTabs/HistoryTabs'
import { Skeleton } from '#components/Skeleton/Skeleton'
import { HistoryBodyWeightView } from '#pages/history/HistoryBodyWeightView'
import { HistoryCalendarView } from '#pages/history/HistoryCalendarView'
import { HistoryListView } from '#pages/history/HistoryListView'
import { HistoryReportView } from '#pages/history/HistoryReportView'
import styles from '#pages/HistoryPage.module.css'

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
      <HistoryTabs
        activeView={view}
        onViewChange={(nextView) => {
          setView(nextView)
        }}
      />

      {view === 'weight' && <HistoryBodyWeightView />}

      {view !== 'weight' && isError && <ErrorRetry onRetry={retry} />}

      {view !== 'weight' && isPending && !isError && (
        <div className={styles.skeletonStack}>
          <Skeleton height={320} />
        </div>
      )}

      {view !== 'weight' && !isPending && !isError && (
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
