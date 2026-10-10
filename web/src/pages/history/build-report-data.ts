import type { NutrientDefinition } from '#api/nutrient-definitions'
import type { NutrientRow } from '#components/NutritionSummary/build-nutrition-summary-data'
import { buildNutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { formatJstMonthDay, weekdayLabelJa } from '#lib/jst-date'

export type ReportPeriod = 'week' | 'month'

const ENERGY_CODE = 'energy_kcal'
const OVER_TARGET_RATIO = 1.1
const MAX_HEIGHT_TARGET_RATIO = 1.2
const MONTH_LABEL_INTERVAL = 5

interface ReportDayBar {
  readonly date: string
  readonly kcal: number | null
  readonly heightPct: number
  readonly hasData: boolean
  readonly hasUnknownValues: boolean
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
  readonly daysWithUnknownValuesCount: number
}

interface ReportDayTotals {
  readonly totals: Readonly<Record<string, number>>
  readonly hasUnknownValues: boolean
}

// periodDates must be non-empty and ascending (e.g. from jstDateRange).
// perDayTotals holds each JST calendar day's known nutrients and status.
export const buildReportData = (
  periodDates: readonly string[],
  period: ReportPeriod,
  perDayTotals: ReadonlyMap<string, ReportDayTotals>,
  definitions: ReadonlyArray<NutrientDefinition>,
  targets: Readonly<Record<string, number>> | null,
): ReportData => {
  const energyTarget = targets?.[ENERGY_CODE]
  const kcalOf = (date: string): number | undefined => {
    const kcal = perDayTotals.get(date)?.totals[ENERGY_CODE]
    return kcal === undefined ? undefined : Math.round(kcal)
  }

  const maxKcal = Math.max(...periodDates.map((date) => kcalOf(date) ?? 0), 1)
  const maxHeight = Math.max(
    energyTarget !== undefined ? energyTarget * MAX_HEIGHT_TARGET_RATIO : 0,
    maxKcal,
  )

  const days: ReportDayBar[] = periodDates.map((date) => {
    const dayTotals = perDayTotals.get(date)
    const hasUnknownValues = dayTotals?.hasUnknownValues ?? false
    const knownKcal = kcalOf(date)
    const kcal =
      hasUnknownValues && knownKcal === undefined ? null : (knownKcal ?? 0)
    const day = Number(date.slice(8, 10))
    return {
      date,
      kcal,
      heightPct: ((kcal ?? 0) / maxHeight) * 100,
      hasData: kcal !== null && kcal > 0,
      hasUnknownValues,
      isOverTarget:
        !hasUnknownValues &&
        energyTarget !== undefined &&
        kcal !== null &&
        kcal > energyTarget * OVER_TARGET_RATIO,
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

  const daysWithData = periodDates.filter(
    (date) =>
      !(perDayTotals.get(date)?.hasUnknownValues ?? false) &&
      (kcalOf(date) ?? 0) > 0,
  )
  const daysWithUnknownValuesCount = periodDates.filter(
    (date) => perDayTotals.get(date)?.hasUnknownValues ?? false,
  ).length
  const avgTotals: Record<string, number> = {}
  for (const date of daysWithData) {
    const totals = perDayTotals.get(date)?.totals ?? {}
    for (const [code, value] of Object.entries(totals)) {
      avgTotals[code] = (avgTotals[code] ?? 0) + value / daysWithData.length
    }
  }

  const summary = buildNutritionSummaryData(
    avgTotals,
    definitions,
    targets,
    daysWithData.length === 0 && daysWithUnknownValuesCount > 0,
  )
  const energyDefinition = definitions.find((d) => d.code === ENERGY_CODE)
  const energyRow: NutrientRow = {
    code: ENERGY_CODE,
    label: energyDefinition?.displayName ?? 'エネルギー',
    unit: energyDefinition?.unit ?? 'kcal',
    value: summary.energy.value,
    isUnknown: summary.energy.isUnknown,
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
    daysWithUnknownValuesCount,
  }
}
