import { Navigate, useParams } from 'react-router'

import { DayDetailView } from '#pages/DayDetailView'

export const DayPage = (): React.JSX.Element => {
  const { date } = useParams<{ date: string }>()
  if (date === undefined) return <Navigate to="/" replace />

  return <DayDetailView date={date} variant="day" />
}
