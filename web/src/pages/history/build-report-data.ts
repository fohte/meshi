import type { NutrientDefinition } from '#api/nutrient-definitions'
import type { NutrientRow } from '#components/NutritionSummary/build-nutrition-summary-data'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { formatJstMonthDay, weekdayLabelJa } from '#lib/jst-date'

export type ReportPeriod = 'week' | 'month'

const ENERGY_CODE = 'energy_kcal'
const OVER_TARGET_RATIO = 1.1
const MAX_HEIGHT_TARGET_RATIO = 1.2
const MONTH_LABEL_INTERVAL = 5

export interface ReportDayBar {
  readonly date: string
  readonly kcal: number
  readonly heightPct: number
  readonly hasData: boolean
  readonly isOverTarget: boolean
  readonly label: string
}

export interface ReportData {
  readonly rangeText: string
  readonly days: ReadonlyArray<ReportDayBar>
  readonly targetLinePct: number | null
  readonly avgRows: ReadonlyArray<NutrientRow>
  readonly tableRows: ReadonlyArray<NutrientRow>
  readonly daysWithDataCount: number
}

// periodDates must be non-empty and ascending (e.g. from jstDateRange).
// perDayTotals holds each JST calendar day's full nutrient totals.
export const buildReportData = (
  periodDates: readonly string[],
  period: ReportPeriod,
  perDayTotals: ReadonlyMap<string, Readonly<Record<string, number>>>,
  definitions: ReadonlyArray<NutrientDefinition>,
  targets: Readonly<Record<string, number>> | null,
): ReportData => {
  const energyTarget = targets?.[ENERGY_CODE]
  const kcalOf = (date: string): number =>
    Math.round(perDayTotals.get(date)?.[ENERGY_CODE] ?? 0)

  const maxKcal = Math.max(...periodDates.map(kcalOf), 1)
  const maxHeight = Math.max(
    energyTarget !== undefined ? energyTarget * MAX_HEIGHT_TARGET_RATIO : 0,
    maxKcal,
  )

  const days: ReportDayBar[] = periodDates.map((date) => {
    const kcal = kcalOf(date)
    const day = Number(date.slice(8, 10))
    return {
      date,
      kcal,
      heightPct: (kcal / maxHeight) * 100,
      hasData: kcal > 0,
      isOverTarget:
        energyTarget !== undefined && kcal > energyTarget * OVER_TARGET_RATIO,
      label:
        period === 'week'
          ? weekdayLabelJa(date)
          : day % MONTH_LABEL_INTERVAL === 0
            ? String(day)
            : '',
    }
  })

  const firstDate = periodDates[0] ?? ''
  const lastDate = periodDates[periodDates.length - 1] ?? ''
  const rangeText = `${formatJstMonthDay(firstDate)} – ${formatJstMonthDay(lastDate)}`

  const daysWithData = periodDates.filter((date) => kcalOf(date) > 0)
  const avgTotals: Record<string, number> = {}
  for (const date of daysWithData) {
    const totals = perDayTotals.get(date) ?? {}
    for (const [code, value] of Object.entries(totals)) {
      avgTotals[code] = (avgTotals[code] ?? 0) + value / daysWithData.length
    }
  }

  const summary = buildNutritionSummaryData(avgTotals, definitions, targets)
  const energyDefinition = definitions.find((d) => d.code === ENERGY_CODE)
  const energyRow: NutrientRow = {
    code: ENERGY_CODE,
    label: energyDefinition?.displayName ?? 'エネルギー',
    unit: energyDefinition?.unit ?? 'kcal',
    value: summary.energy.value,
    target: summary.energy.target,
    pct: summary.energy.pct ?? 0,
    over: summary.energy.over,
  }

  return {
    rangeText,
    days,
    targetLinePct:
      energyTarget !== undefined ? (energyTarget / maxHeight) * 100 : null,
    avgRows: [energyRow, ...summary.majorRows],
    tableRows: summary.allRows,
    daysWithDataCount: daysWithData.length,
  }
}
