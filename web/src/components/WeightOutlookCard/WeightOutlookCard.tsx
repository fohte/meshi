import type { WeightOutlook } from '#api/weight-outlook'
import { getWeightOutlookMessage } from '#components/WeightOutlookCard/weight-outlook-message'
import styles from '#components/WeightOutlookCard/WeightOutlookCard.module.css'

export interface WeightOutlookCardProps {
  readonly state: 'loading' | 'error' | 'loaded'
  readonly outlook?: WeightOutlook | undefined
  readonly onRetry: () => void
}

const formatWeight = (weightKg: number): string =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(weightKg)

const formatSlope = (slopeKgPerWeek: number): string =>
  new Intl.NumberFormat('ja-JP', {
    maximumFractionDigits: 2,
    signDisplay: 'always',
  }).format(slopeKgPerWeek)

export const WeightOutlookCard = ({
  state,
  outlook,
  onRetry,
}: WeightOutlookCardProps): React.JSX.Element => (
  <section className={styles.card} aria-labelledby="weight-outlook-title">
    <div className={styles.header}>
      <span className={styles.eyebrow}>WEIGHT OUTLOOK</span>
      <h2 id="weight-outlook-title">体重の見通し</h2>
    </div>

    {state === 'loading' && (
      <p className={styles.status} role="status">
        体重の見通しを読み込んでいます...
      </p>
    )}

    {state === 'error' && (
      <div className={styles.status}>
        <p>体重の見通しを読み込めませんでした。</p>
        <button type="button" className={styles.retry} onClick={onRetry}>
          再読み込み
        </button>
      </div>
    )}

    {state === 'loaded' && outlook !== undefined && (
      <>
        <div className={styles.metrics}>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>最新の体重</span>
            <span className={styles.weightValue}>
              {outlook.latestWeightKg === null
                ? '—'
                : formatWeight(outlook.latestWeightKg)}
              <span className={styles.unit}>kg</span>
            </span>
          </div>
          <div className={styles.metric}>
            <span className={styles.metricLabel}>直近のトレンド</span>
            {outlook.trend === null ? (
              <span className={styles.metricValue}>算出に必要な記録が不足</span>
            ) : (
              <>
                <span className={styles.metricValue}>
                  {outlook.trend.slopeKgPerWeek < 0
                    ? '減少傾向'
                    : outlook.trend.slopeKgPerWeek > 0
                      ? '増加傾向'
                      : '横ばい'}
                </span>
                <span className={styles.pace}>
                  週あたり {formatSlope(outlook.trend.slopeKgPerWeek)} kg
                </span>
              </>
            )}
          </div>
        </div>
        <p className={styles.message}>{getWeightOutlookMessage(outlook)}</p>
      </>
    )}
  </section>
)
