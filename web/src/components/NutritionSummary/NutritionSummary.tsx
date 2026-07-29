import { useState } from 'react'
import { Link } from 'react-router'

import type { NutritionSummaryData } from '#components/NutritionSummary/build-nutrition-summary-data'
import { formatNutrientValue } from '#components/NutritionSummary/format-nutrient-value'
import styles from '#components/NutritionSummary/NutritionSummary.module.css'

export interface NutritionSummaryProps {
  readonly data: NutritionSummaryData
  readonly hasEstimatedValues: boolean
}

export const NutritionSummary = ({
  data,
  hasEstimatedValues,
}: NutritionSummaryProps): React.JSX.Element => {
  const [allOpen, setAllOpen] = useState(false)
  const { energy, pfc, majorRows, allRows, hasAnyTarget } = data

  return (
    <section className={styles.card}>
      <div className={styles.header}>
        <span className={styles.eyebrow}>NUTRITION</span>
        {hasEstimatedValues && (
          <span className={styles.estimateNote}>
            推定値<span className={styles.estimateMark}> ~ </span>を含む
          </span>
        )}
      </div>

      <div className={styles.energyRow}>
        <span className={styles.energyValue}>{Math.round(energy.value)}</span>
        <span className={styles.energyTarget}>
          / {energy.target === null ? '—' : Math.round(energy.target)} kcal
        </span>
        {energy.pct !== null && (
          <span
            className={styles.energyPct}
            data-over={energy.over ? '' : undefined}
          >
            {Math.round(energy.pct)}%
          </span>
        )}
      </div>
      <div className={styles.track}>
        <div
          className={styles.bar}
          data-over={energy.over ? '' : undefined}
          style={{ width: `${String(Math.min(100, energy.pct ?? 0))}%` }}
        />
      </div>

      <div className={styles.pfcLabel}>PFC BALANCE</div>
      <div className={styles.pfcBar}>
        {pfc.segments.map((segment) => (
          <div
            key={segment.label}
            className={styles.pfcSegment}
            style={{
              width: `${String(segment.pct)}%`,
              background: segment.color,
            }}
          />
        ))}
        <div
          className={styles.pfcMark}
          style={{ left: `${String(pfc.targetMarks[0])}%` }}
        />
        <div
          className={styles.pfcMark}
          style={{ left: `${String(pfc.targetMarks[1])}%` }}
        />
      </div>
      <div className={styles.pfcLegend}>
        {pfc.segments.map((segment) => (
          <div key={segment.label} className={styles.pfcLegendItem}>
            <span
              className={styles.pfcSwatch}
              style={{ background: segment.color }}
            />
            {segment.label}
            <span className={styles.pfcLegendValue}>
              {Math.round(segment.pct)}%
            </span>
            <span className={styles.pfcLegendTarget}>
              ({segment.targetPct}%)
            </span>
          </div>
        ))}
        <div className={styles.pfcHint}>赤線 = 目標比率</div>
      </div>

      <div className={styles.majorRows}>
        {majorRows.map((row) => (
          <div key={row.code} className={styles.majorRow}>
            <div className={styles.majorRowHead}>
              <span className={styles.majorRowLabel}>{row.label}</span>
              <span className={styles.majorRowValue}>
                {formatNutrientValue(row.value, row.unit)}
              </span>
              <span className={styles.majorRowTarget}>
                {row.target === null
                  ? '目標なし'
                  : `/ ${formatNutrientValue(row.target, row.unit)}`}
              </span>
            </div>
            <div className={styles.track}>
              <div
                className={styles.bar}
                data-over={row.over ? '' : undefined}
                style={{ width: `${String(Math.min(100, row.pct))}%` }}
              />
            </div>
          </div>
        ))}
      </div>

      {!hasAnyTarget && (
        <div className={styles.setTargetLink}>
          栄養目標が未設定です。<Link to="/settings">目標を設定</Link>
        </div>
      )}

      <button
        type="button"
        className={styles.toggle}
        onClick={() => {
          setAllOpen((open) => !open)
        }}
      >
        {allOpen ? '− 全栄養素を閉じる' : '+ 全栄養素を開く'}
      </button>

      {allOpen && (
        <table className={styles.allTable}>
          <thead>
            <tr>
              <th>栄養素</th>
              <th>摂取</th>
              <th>目標</th>
            </tr>
          </thead>
          <tbody>
            {allRows.map((row) => (
              <tr key={row.code}>
                <td>{row.label}</td>
                <td>{formatNutrientValue(row.value, row.unit)}</td>
                <td>
                  {row.target === null
                    ? '—'
                    : formatNutrientValue(row.target, row.unit)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}
