import { weekdayLabelJa } from '#lib/jst-date'

const ENERGY_CODE = 'energy_kcal'
const SALT_CODE = 'salt_g'
const OVER_TARGET_PCT = 110
const SUMMARY_HEAD_COUNT = 2

export interface HistoryListCard {
  readonly date: string
  readonly dayText: string
  readonly dowText: string
  readonly summary: string
  readonly metaText: string
  readonly kcalText: string
  readonly pctText: string
  readonly isOverTarget: boolean
}

export interface HistoryListDayTotals {
  readonly date: string
  readonly totals: Readonly<Record<string, number>>
}

const formatMonthSlashDay = (date: string): string =>
  `${String(Number(date.slice(5, 7)))}/${String(Number(date.slice(8, 10)))}`

const buildSummary = (foodNames: ReadonlyArray<string>): string => {
  if (foodNames.length === 0) return '記録なし'
  const head = foodNames.slice(0, SUMMARY_HEAD_COUNT).join('、')
  const restCount = foodNames.length - SUMMARY_HEAD_COUNT
  return restCount > 0 ? `${head} ほか ${String(restCount)} 品` : head
}

// perDay drives which days render a card (only days with at least one meal
// log ever appear there); foodNamesByDate supplies each day's food names in
// eaten-time order for the summary text.
export const buildListCards = (
  perDay: ReadonlyArray<HistoryListDayTotals>,
  foodNamesByDate: ReadonlyMap<string, ReadonlyArray<string>>,
  energyTarget: number | undefined,
): readonly HistoryListCard[] =>
  [...perDay]
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
    .map((day) => {
      const foodNames = foodNamesByDate.get(day.date) ?? []
      const kcal = Math.round(day.totals[ENERGY_CODE] ?? 0)
      const salt = day.totals[SALT_CODE] ?? 0
      const pct =
        energyTarget !== undefined && energyTarget > 0
          ? (kcal / energyTarget) * 100
          : null

      return {
        date: day.date,
        dayText: formatMonthSlashDay(day.date),
        dowText: weekdayLabelJa(day.date),
        summary: buildSummary(foodNames),
        metaText: `${String(foodNames.length)} 品 · 塩分 ${salt.toFixed(1)} g`,
        kcalText: `${String(kcal)} kcal`,
        pctText: pct === null ? '—' : `${String(Math.round(pct))}%`,
        isOverTarget: pct !== null && pct > OVER_TARGET_PCT,
      }
    })
