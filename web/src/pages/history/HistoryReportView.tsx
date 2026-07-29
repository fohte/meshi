import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'

import { fetchMealHistory } from '#api/meal-history'
import type { NutrientDefinition } from '#api/nutrient-definitions'
import { toPromise } from '#api/to-promise'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { formatNutrientValue } from '#components/NutritionSummary/format-nutrient-value'
import { Skeleton } from '#components/Skeleton/Skeleton'
import { jstDateRange, shiftDateString, todayJstDate } from '#lib/jst-date'
import type { ReportPeriod } from '#pages/history/build-report-data'
import { buildReportData } from '#pages/history/build-report-data'
import styles from '#pages/history/HistoryReportView.module.css'

const ENERGY_CODE = 'energy_kcal'
const PERIOD_TABS: ReadonlyArray<readonly [ReportPeriod, string]> = [
  ['week', '週'],
  ['month', '月'],
]
const SPAN_DAYS: Record<ReportPeriod, number> = { week: 7, month: 30 }

export interface HistoryReportViewProps {
  readonly definitions: ReadonlyArray<NutrientDefinition>
  readonly targets: Readonly<Record<string, number>> | null
}

export const HistoryReportView = ({
  definitions,
  targets,
}: HistoryReportViewProps): React.JSX.Element => {
  const today = todayJstDate()
  const [period, setPeriod] = useState<ReportPeriod>('week')
  const [periodOffset, setPeriodOffset] = useState(0)

  const span = SPAN_DAYS[period]
  const end = shiftDateString(today, periodOffset * span)
  const start = shiftDateString(end, -(span - 1))
  const periodDates = jstDateRange(start, span)
  const to = shiftDateString(end, 1)

  const query = useQuery({
    queryKey: ['meal-history', start, to],
    queryFn: () => toPromise(fetchMealHistory(start, to)),
  })

  const perDayTotals = new Map(
    (query.data?.perDay ?? []).map((d) => [d.date, d.totals]),
  )
  const report = buildReportData(
    periodDates,
    period,
    perDayTotals,
    definitions,
    targets,
  )
  const energyTarget = targets?.[ENERGY_CODE]

  const changePeriod = (next: ReportPeriod): void => {
    setPeriod(next)
    setPeriodOffset(0)
  }

  return (
    <div>
      <div className={styles.nav}>
        <div className={styles.periodTabs}>
          {PERIOD_TABS.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={styles.periodTab}
              data-active={period === value ? '' : undefined}
              onClick={() => {
                changePeriod(value)
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.navButton}
          onClick={() => {
            setPeriodOffset((o) => o - 1)
          }}
        >
          ←
        </button>
        <div className={styles.range}>{report.rangeText}</div>
        <button
          type="button"
          className={styles.navButton}
          disabled={periodOffset >= 0}
          onClick={() => {
            setPeriodOffset((o) => Math.min(0, o + 1))
          }}
        >
          →
        </button>
      </div>

      {query.isError && (
        <ErrorRetry
          onRetry={() => {
            void query.refetch()
          }}
        />
      )}

      {query.isPending && (
        <div className={styles.skeletonStack}>
          <Skeleton height={200} />
          <Skeleton height={160} />
          <Skeleton height={240} />
        </div>
      )}

      {!query.isPending && !query.isError && (
        <>
          <section className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockMark}>##</span>
              <span className={styles.blockTitle}>エネルギー推移</span>
              <span className={styles.blockNote}>
                {period === 'week' ? '日次' : '30 日'}
              </span>
            </div>
            <div className={styles.chart} data-gap={period}>
              {report.targetLinePct !== null && (
                <div
                  className={styles.targetLine}
                  style={{ bottom: `${String(report.targetLinePct)}%` }}
                />
              )}
              {report.days.map((day) => (
                <div key={day.date} className={styles.barColumn}>
                  <div
                    className={styles.barFill}
                    data-state={
                      day.isOverTarget
                        ? 'over'
                        : day.hasData
                          ? 'filled'
                          : 'empty'
                    }
                    style={{ height: `${String(day.heightPct)}%` }}
                  />
                </div>
              ))}
            </div>
            <div className={styles.chartLabels} data-gap={period}>
              {report.days.map((day) => (
                <div key={day.date} className={styles.chartLabel}>
                  {day.label}
                </div>
              ))}
            </div>
            {energyTarget !== undefined && (
              <div className={styles.chartHint}>
                赤線 = 目標 {String(Math.round(energyTarget))} kcal
              </div>
            )}
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockMark}>##</span>
              <span className={styles.blockTitle}>主要栄養素の 1 日平均</span>
              <span className={styles.blockNote}>
                {report.daysWithDataCount} 日分
              </span>
            </div>
            <div className={styles.avgRows}>
              {report.avgRows.map((row) => (
                <div key={row.code}>
                  <div className={styles.avgRowHead}>
                    <span className={styles.avgRowLabel}>{row.label}</span>
                    <span className={styles.avgRowValue}>
                      {formatNutrientValue(row.value, row.unit)}
                    </span>
                    <span className={styles.avgRowTarget}>
                      {row.target === null
                        ? '目標なし'
                        : `/ ${formatNutrientValue(row.target, row.unit)}`}
                    </span>
                  </div>
                  <div className={styles.track}>
                    <div
                      className={styles.trackFill}
                      data-over={row.over ? '' : undefined}
                      style={{ width: `${String(Math.min(100, row.pct))}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.block}>
            <div className={styles.blockHead}>
              <span className={styles.blockMark}>##</span>
              <span className={styles.blockTitle}>全栄養素の平均値</span>
              <span className={styles.blockNote}>目標比付き</span>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>栄養素</th>
                  <th>1 日平均</th>
                  <th>目標</th>
                  <th>目標比</th>
                </tr>
              </thead>
              <tbody>
                {report.tableRows.map((row) => (
                  <tr key={row.code}>
                    <td>{row.label}</td>
                    <td>{formatNutrientValue(row.value, row.unit)}</td>
                    <td>
                      {row.target === null
                        ? '—'
                        : formatNutrientValue(row.target, row.unit)}
                    </td>
                    <td data-over={row.over ? '' : undefined}>
                      {row.target === null
                        ? '—'
                        : `${String(Math.round(row.pct))}%`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  )
}
