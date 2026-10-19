import type { StockStatus } from '#api/stock'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import {
  StockCountForm,
  type StockCountFormProps,
} from '#components/Stock/StockCountForm'
import styles from '#components/Stock/StockView.module.css'

type StockCountFormState = Omit<StockCountFormProps, 'stockItems'>

export interface StockViewProps {
  readonly data: StockStatus | null
  readonly isLoading: boolean
  readonly isFetching: boolean
  readonly isError: boolean
  readonly onRetry: () => void
  readonly onRefresh: () => void
  readonly countForm: StockCountFormState
}

const quantityFormatter = new Intl.NumberFormat('ja-JP', {
  maximumFractionDigits: 20,
})

const formatQuantity = (quantity: number): string =>
  quantityFormatter.format(quantity)

const formatOptionalQuantity = (quantity: number | null | undefined): string =>
  quantity === null || quantity === undefined
    ? '未設定'
    : formatQuantity(quantity)

const displayDate = (date: string | null): string => date ?? '不明'

interface DeliverySummaryProps {
  readonly sourceRef: string | null
  readonly expectedDate: string | null
  readonly changeDeadline: string | null
  readonly headingLevel: 'h3' | 'h4'
}

const DeliverySummary = ({
  sourceRef,
  expectedDate,
  changeDeadline,
  headingLevel,
}: DeliverySummaryProps): React.JSX.Element => {
  const Heading = headingLevel
  const headingClassName =
    headingLevel === 'h3' ? styles.cardTitle : styles.warningDeliveryTitle

  return (
    <div>
      <Heading className={headingClassName}>
        注文番号 {sourceRef ?? '不明'}
      </Heading>
      <dl className={styles.summary}>
        <div>
          <dt>入荷予定日</dt>
          <dd>{displayDate(expectedDate)}</dd>
        </div>
        <div>
          <dt>変更締切</dt>
          <dd>{displayDate(changeDeadline)}</dd>
        </div>
      </dl>
    </div>
  )
}

const targetDateTypeLabel = (type: 'best_before' | 'eat_by'): string =>
  type === 'best_before' ? '賞味期限' : '食べ切り目標日'

const riskTypeLabel = (
  type: 'deadline_passed' | 'consumption_rate_below_required',
): string => (type === 'deadline_passed' ? '期限超過' : '消費ペース不足')

const PRIORITY_REASON_LABELS: Record<
  StockStatus['priorityLots'][number]['reasons'][number],
  string
> = {
  best_before: '賞味期限が近い',
  eat_by: '食べ切り目標日が近い',
  oldest_received: '古い入荷分',
  deadline_passed: '期限超過',
  consumption_rate_below_required: '消費ペース不足',
}

type PlannedDelivery = StockStatus['plannedDeliveries'][number]

const StockViewContent = ({
  data,
  isLoading,
  isFetching,
  isError,
  onRetry,
  onRefresh,
  countForm,
  plannedDeliveriesById,
}: StockViewProps & {
  readonly plannedDeliveriesById: ReadonlyMap<string, PlannedDelivery>
}): React.JSX.Element => (
  <div className={styles.page}>
    <header className={styles.pageHeader}>
      <div>
        <h1 className={styles.heading}>
          <span className={styles.hash}>#</span> 在庫
        </h1>
        <p className={styles.description}>
          数量は食品登録時の単位で表示しています。
        </p>
      </div>
      <div className={styles.headerActions}>
        {isFetching && (
          <span className={styles.refreshStatus} role="status">
            更新中…
          </span>
        )}
        <button
          type="button"
          aria-label="在庫を更新"
          className={styles.refreshButton}
          disabled={isFetching}
          onClick={onRefresh}
        >
          更新
        </button>
      </div>
    </header>

    {isLoading && (
      <div className={styles.state} role="status">
        読み込み中…
      </div>
    )}

    {!isLoading && data === null && (
      <ErrorRetry message="在庫の取得に失敗しました。" onRetry={onRetry} />
    )}

    {data !== null && (
      <div className={styles.content}>
        {isError && (
          <div className={styles.staleError} role="alert">
            <p>更新に失敗しました。表示中の在庫は最後に取得した内容です。</p>
            <button type="button" onClick={onRetry}>
              再試行
            </button>
          </div>
        )}

        {data.stockItems.length > 0 && (
          <StockCountForm stockItems={data.stockItems} {...countForm} />
        )}

        <section className={styles.section} aria-labelledby="stock-items-title">
          <h2 className={styles.sectionTitle} id="stock-items-title">
            在庫
          </h2>
          {data.stockItems.length === 0 ? (
            <p className={styles.emptyState}>在庫対象はありません。</p>
          ) : (
            <div className={styles.cardList}>
              {data.stockItems.map((item) => (
                <article className={styles.card} key={item.foodMasterId}>
                  <header className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{item.foodName}</h3>
                    <p className={styles.totalQuantity}>
                      残数 {formatQuantity(item.totalQuantity)}
                    </p>
                  </header>
                  <dl className={styles.summary}>
                    <div>
                      <dt>保存場所</dt>
                      <dd>{item.storageLocation?.name ?? '未設定'}</dd>
                    </div>
                    <div>
                      <dt>容量</dt>
                      <dd>
                        {formatOptionalQuantity(item.storageLocation?.capacity)}
                      </dd>
                    </div>
                    <div>
                      <dt>食べ切り目安</dt>
                      <dd>
                        {item.eatWithinDays === null
                          ? '未設定'
                          : `${formatQuantity(item.eatWithinDays)} 日`}
                      </dd>
                    </div>
                  </dl>
                  {item.lots.length === 0 ? (
                    <p className={styles.noLots}>入荷分はありません。</p>
                  ) : (
                    <details className={styles.lots}>
                      <summary>入荷分 {item.lots.length} 件</summary>
                      <ul className={styles.lotList}>
                        {item.lots.map((lot) => (
                          <li className={styles.lot} key={lot.id}>
                            <p className={styles.lotQuantity}>
                              残数 {formatQuantity(lot.remainingQuantity)}
                            </p>
                            <dl className={styles.summary}>
                              <div>
                                <dt>受領日</dt>
                                <dd>{displayDate(lot.receivedDate)}</dd>
                              </div>
                              <div>
                                <dt>賞味期限</dt>
                                <dd>{displayDate(lot.bestBefore)}</dd>
                              </div>
                              <div>
                                <dt>食べ切り目標日</dt>
                                <dd>{displayDate(lot.eatBy)}</dd>
                              </div>
                            </dl>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className={styles.section}
          aria-labelledby="planned-deliveries-title"
        >
          <h2 className={styles.sectionTitle} id="planned-deliveries-title">
            入荷予定
          </h2>
          {data.plannedDeliveries.length === 0 ? (
            <p className={styles.emptyState}>入荷予定はありません。</p>
          ) : (
            <div className={styles.cardList}>
              {data.plannedDeliveries.map((delivery) => (
                <article className={styles.card} key={delivery.id}>
                  <DeliverySummary
                    sourceRef={delivery.sourceRef}
                    expectedDate={delivery.expectedDate}
                    changeDeadline={delivery.changeDeadline}
                    headingLevel="h3"
                  />
                  <ul className={styles.deliveryItems}>
                    {delivery.items.map((item) => (
                      <li key={item.foodMasterId}>
                        <span>{item.foodName}</span>
                        <span>数量 {formatQuantity(item.quantity)}</span>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className={styles.section}
          aria-labelledby="capacity-warnings-title"
        >
          <h2 className={styles.sectionTitle} id="capacity-warnings-title">
            容量超過
          </h2>
          {data.capacityWarnings.length === 0 ? (
            <p className={styles.emptyState}>容量超過の警告はありません。</p>
          ) : (
            <div className={styles.cardList}>
              {data.capacityWarnings.map((warning) => (
                <article className={styles.card} key={warning.id}>
                  <header className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>
                      {warning.storageLocationName}
                    </h3>
                    <p className={styles.warningDate}>{warning.expectedDate}</p>
                  </header>
                  <p className={styles.warningSummary}>
                    予測 {formatQuantity(warning.projectedQuantity)} / 容量{' '}
                    {formatQuantity(warning.capacity)} / 超過{' '}
                    {formatQuantity(warning.excessQuantity)}
                  </p>
                  <ul className={styles.warningDeliveries}>
                    {warning.deliveries.map((warningDelivery) => {
                      const delivery = plannedDeliveriesById.get(
                        warningDelivery.deliveryId,
                      )

                      return (
                        <li
                          className={styles.warningDelivery}
                          key={warningDelivery.deliveryId}
                        >
                          <DeliverySummary
                            sourceRef={delivery?.sourceRef ?? null}
                            expectedDate={delivery?.expectedDate ?? null}
                            changeDeadline={warningDelivery.changeDeadline}
                            headingLevel="h4"
                          />
                        </li>
                      )
                    })}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className={styles.section}
          aria-labelledby="eat-by-warnings-title"
        >
          <h2 className={styles.sectionTitle} id="eat-by-warnings-title">
            食べ切り警告
          </h2>
          {data.eatByWarnings.length === 0 ? (
            <p className={styles.emptyState}>食べ切りの警告はありません。</p>
          ) : (
            <div className={styles.cardList}>
              {data.eatByWarnings.map((warning) => (
                <article className={styles.card} key={warning.id}>
                  <header className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{warning.foodName}</h3>
                    <p className={styles.riskType}>
                      {riskTypeLabel(warning.riskType)}
                    </p>
                  </header>
                  <p className={styles.warningSummary}>
                    {targetDateTypeLabel(warning.targetDateType)}{' '}
                    {warning.targetDate} / 残数{' '}
                    {formatQuantity(warning.remainingQuantity)}
                  </p>
                  <dl className={styles.summary}>
                    <div>
                      <dt>消費ペース算定量</dt>
                      <dd>
                        {warning.quantityUsedForRate === null
                          ? '不明'
                          : formatQuantity(warning.quantityUsedForRate)}
                      </dd>
                    </div>
                    <div>
                      <dt>期限まで</dt>
                      <dd>
                        {warning.daysUntilTarget === null
                          ? '不明'
                          : `${formatQuantity(warning.daysUntilTarget)} 日`}
                      </dd>
                    </div>
                    <div>
                      <dt>必要な消費量</dt>
                      <dd>
                        {warning.requiredDailyConsumption === null
                          ? '不明'
                          : `${formatQuantity(warning.requiredDailyConsumption)} / 日`}
                      </dd>
                    </div>
                    <div>
                      <dt>実際の消費量</dt>
                      <dd>
                        {formatQuantity(warning.actualDailyConsumption)} / 日
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </section>

        <section
          className={styles.section}
          aria-labelledby="priority-lots-title"
        >
          <h2 className={styles.sectionTitle} id="priority-lots-title">
            先に食べたい入荷分
          </h2>
          {data.priorityLots.length === 0 ? (
            <p className={styles.emptyState}>
              先に食べたい入荷分はありません。
            </p>
          ) : (
            <div className={styles.cardList}>
              {data.priorityLots.map((lot) => (
                <article
                  className={styles.card}
                  key={`${lot.foodMasterId}:${lot.stockLotId}`}
                >
                  <header className={styles.cardHeader}>
                    <h3 className={styles.cardTitle}>{lot.foodName}</h3>
                    <p className={styles.totalQuantity}>
                      残数 {formatQuantity(lot.remainingQuantity)}
                    </p>
                  </header>
                  <p className={styles.warningSummary}>
                    対象日 {displayDate(lot.targetDate)}
                  </p>
                  <ul className={styles.reasonList}>
                    {lot.reasons.map((reason) => (
                      <li key={reason}>{PRIORITY_REASON_LABELS[reason]}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    )}
  </div>
)

export const StockView = (props: StockViewProps): React.JSX.Element => {
  const plannedDeliveriesById = new Map(
    (props.data?.plannedDeliveries ?? []).map(
      (delivery) => [delivery.id, delivery] as const,
    ),
  )

  return (
    <StockViewContent
      {...props}
      plannedDeliveriesById={plannedDeliveriesById}
    />
  )
}
