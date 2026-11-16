import type { BodyWeight } from '#domain/body-weight/types'
import type { JstDate } from '#lib/jst-date'

export interface WeightOutlookDailyPoint {
  readonly date: JstDate
  readonly weightKg: number
}

export const averageWeightOutlookMeasurementsByDate = (
  weights: ReadonlyArray<Pick<BodyWeight, 'date' | 'weightKg'>>,
): WeightOutlookDailyPoint[] => {
  const byDate = new Map<JstDate, { total: number; count: number }>()
  for (const { date, weightKg } of weights) {
    const current = byDate.get(date) ?? { total: 0, count: 0 }
    current.total += weightKg
    current.count += 1
    byDate.set(date, current)
  }
  return [...byDate]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([date, value]) => ({ date, weightKg: value.total / value.count }))
}
