import { useQuery } from '@tanstack/react-query'

import { toPromise } from '#api/to-promise'
import {
  fetchWeightOutlook,
  WEIGHT_OUTLOOK_QUERY_KEY,
} from '#api/weight-outlook'
import { WeightOutlookCard } from '#components/WeightOutlookCard/WeightOutlookCard'
import { todayJstDate } from '#lib/jst-date'
import { DayDetailView } from '#pages/DayDetailView'

export const TodayPage = (): React.JSX.Element => {
  const outlookQuery = useQuery({
    queryKey: WEIGHT_OUTLOOK_QUERY_KEY,
    queryFn: () => toPromise(fetchWeightOutlook()),
  })

  return (
    <>
      <WeightOutlookCard
        state={
          outlookQuery.isPending
            ? 'loading'
            : outlookQuery.isError
              ? 'error'
              : 'loaded'
        }
        outlook={outlookQuery.data}
        onRetry={() => {
          void outlookQuery.refetch()
        }}
      />
      <DayDetailView date={todayJstDate()} />
    </>
  )
}
