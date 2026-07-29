import { todayJstDate } from '#lib/jst-date'
import { DayDetailView } from '#pages/DayDetailView'

export const TodayPage = (): React.JSX.Element => (
  <DayDetailView date={todayJstDate()} variant="today" />
)
