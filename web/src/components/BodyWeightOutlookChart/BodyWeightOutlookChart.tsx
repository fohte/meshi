import type { WeightOutlook } from '#api/weight-outlook'
import styles from '#components/BodyWeightOutlookChart/BodyWeightOutlookChart.module.css'
import { getWeightOutlookMessage } from '#components/WeightOutlookCard/weight-outlook-message'

export interface BodyWeightOutlookChartProps {
  readonly state: 'loading' | 'error' | 'loaded'
  readonly outlook?: WeightOutlook | undefined
  readonly onRetry: () => void
}

const width = 960
const height = 340
const plot = { left: 58, top: 22, right: 938, bottom: 286 }
const dayMilliseconds = 24 * 60 * 60 * 1000

const toDay = (date: string): number =>
  Date.parse(`${date}T00:00:00.000Z`) / dayMilliseconds

const fromDay = (day: number): string =>
  new Date(day * dayMilliseconds).toISOString().slice(0, 10)

const formatDate = (date: string): string => {
  const [, month, day] = date.split('-')
  return [Number(month), '月', Number(day), '日'].join('')
}

const linePath = (
  points: ReadonlyArray<{ readonly date: string; readonly value: number }>,
  x: (date: string) => number,
  y: (value: number) => number,
): string =>
  points
    .map(
      (point, index) =>
        `${index === 0 ? 'M' : 'L'} ${x(point.date).toFixed(2)} ${y(point.value).toFixed(2)}`,
    )
    .join(' ')

const makeChart = (outlook: WeightOutlook) => {
  const allDates = [
    ...outlook.points.map((point) => point.date),
    ...(outlook.trend?.points.map((point) => point.date) ?? []),
    ...(outlook.arrivalDateRange === null
      ? []
      : [outlook.arrivalDateRange.from, outlook.arrivalDateRange.to]),
  ]
  const firstDay = Math.min(...allDates.map(toDay))
  const lastDay = Math.max(...allDates.map(toDay))
  const dateSpan = Math.max(lastDay - firstDay, 1)
  const x = (date: string): number =>
    plot.left + ((toDay(date) - firstDay) / dateSpan) * (plot.right - plot.left)
  const weights = [
    ...outlook.points.map((point) => point.weightKg),
    ...(outlook.trend?.points.flatMap((point) => [
      point.lowerKg,
      point.upperKg,
    ]) ?? []),
    ...(outlook.goalWeightKg === null ? [] : [outlook.goalWeightKg]),
  ]
  const minimum = Math.min(...weights)
  const maximum = Math.max(...weights)
  const padding = Math.max((maximum - minimum) * 0.12, 0.25)
  const minWeight = minimum - padding
  const maxWeight = maximum + padding
  const y = (weight: number): number =>
    plot.bottom -
    ((weight - minWeight) / (maxWeight - minWeight)) * (plot.bottom - plot.top)
  const gridWeights = [maxWeight, (maxWeight + minWeight) / 2, minWeight]
  const trendPoints = outlook.trend?.points ?? []
  const bandPath =
    trendPoints.length === 0
      ? ''
      : [
          ...trendPoints.map(
            (point, index) =>
              `${index === 0 ? 'M' : 'L'} ${x(point.date).toFixed(2)} ${y(point.upperKg).toFixed(2)}`,
          ),
          ...trendPoints
            .slice()
            .reverse()
            .map(
              (point) =>
                `L ${x(point.date).toFixed(2)} ${y(point.lowerKg).toFixed(2)}`,
            ),
          'Z',
        ].join(' ')
  const trendPath = linePath(
    trendPoints.map(({ date, weightKg }) => ({ date, value: weightKg })),
    x,
    y,
  )
  const actualPath = linePath(
    outlook.points.map(({ date, weightKg }) => ({ date, value: weightKg })),
    x,
    y,
  )

  return {
    x,
    y,
    firstDate: fromDay(firstDay),
    lastDate: fromDay(lastDay),
    gridWeights,
    bandPath,
    trendPath,
    actualPath,
  }
}

const formatWeight = (weight: number): string =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 }).format(weight)

const OutlookSvg = ({ outlook }: { readonly outlook: WeightOutlook }) => {
  const chart = makeChart(outlook)
  const arrival = outlook.arrivalDateRange
  const arrivalX = arrival === null ? null : chart.x(arrival.from)
  const arrivalWidth =
    arrival === null
      ? 0
      : Math.max(chart.x(arrival.to) - chart.x(arrival.from), 3)

  return (
    <svg
      className={styles.chart}
      viewBox={[0, 0, width, height].join(' ')}
      role="img"
      aria-label="体重の記録、トレンド、目標体重と到達時期の見通し"
    >
      <title>体重の記録と見通し</title>
      {arrivalX !== null && (
        <rect
          className={styles.arrivalRange}
          x={arrivalX}
          y={plot.top}
          width={arrivalWidth}
          height={plot.bottom - plot.top}
        />
      )}
      {chart.gridWeights.map((weight) => (
        <g key={weight}>
          <line
            className={styles.gridLine}
            x1={plot.left}
            x2={plot.right}
            y1={chart.y(weight)}
            y2={chart.y(weight)}
          />
          <text
            className={styles.axisLabel}
            x={plot.left - 10}
            y={chart.y(weight) + 4}
          >
            {formatWeight(weight)}
          </text>
        </g>
      ))}
      {outlook.goalWeightKg !== null && (
        <>
          <line
            className={styles.goalLine}
            x1={plot.left}
            x2={plot.right}
            y1={chart.y(outlook.goalWeightKg)}
            y2={chart.y(outlook.goalWeightKg)}
          />
          <text
            className={styles.goalLabel}
            x={plot.right - 4}
            y={chart.y(outlook.goalWeightKg) - 6}
            textAnchor="end"
          >
            目標 {formatWeight(outlook.goalWeightKg)} kg
          </text>
        </>
      )}
      {chart.bandPath !== '' && (
        <path className={styles.trendBand} d={chart.bandPath} />
      )}
      {chart.trendPath !== '' && (
        <path className={styles.trendLine} d={chart.trendPath} />
      )}
      {chart.actualPath !== '' && (
        <path className={styles.actualLine} d={chart.actualPath} />
      )}
      {outlook.points.map((point) => (
        <circle
          className={styles.actualPoint}
          key={point.date}
          cx={chart.x(point.date)}
          cy={chart.y(point.weightKg)}
          r="4"
        />
      ))}
      <text className={styles.dateLabel} x={plot.left} y={height - 18}>
        {formatDate(chart.firstDate)}
      </text>
      <text
        className={styles.dateLabel}
        x={plot.right}
        y={height - 18}
        textAnchor="end"
      >
        {formatDate(chart.lastDate)}
      </text>
    </svg>
  )
}

export const BodyWeightOutlookChart = ({
  state,
  outlook,
  onRetry,
}: BodyWeightOutlookChartProps): React.JSX.Element => (
  <section className={styles.card} aria-labelledby="body-weight-outlook-title">
    <div className={styles.header}>
      <span className={styles.eyebrow}>WEIGHT OUTLOOK</span>
      <h2 id="body-weight-outlook-title">体重の見通し</h2>
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
        {outlook.points.length > 0 && <OutlookSvg outlook={outlook} />}
        <p className={styles.message}>{getWeightOutlookMessage(outlook)}</p>
        {outlook.points.length === 0 && (
          <p className={styles.emptyHint}>
            体重を記録すると、ここに推移と見通しが表示されます。
          </p>
        )}
        {outlook.points.length > 0 && (
          <ul className={styles.legend} aria-label="グラフの凡例">
            <li>
              <span className={styles.actualKey} />
              記録
            </li>
            {outlook.trend !== null && (
              <li>
                <span className={styles.trendKey} />
                トレンドと 80% 区間
              </li>
            )}
            {outlook.goalWeightKg !== null && (
              <li>
                <span className={styles.goalKey} />
                目標体重
              </li>
            )}
            {outlook.arrivalDateRange !== null && (
              <li>
                <span className={styles.arrivalKey} />
                到達時期の幅
              </li>
            )}
          </ul>
        )}
      </>
    )}
  </section>
)
