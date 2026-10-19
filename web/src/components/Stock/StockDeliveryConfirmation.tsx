import styles from '#components/Stock/StockDeliveryConfirmation.module.css'

export interface StockDeliveryConfirmationItem {
  readonly foodMasterId: string
  readonly foodName: string
  readonly quantity: number
}

export interface StockDeliveryConfirmationProps {
  readonly mode: 'cancel' | 'receive'
  readonly sourceRef: string | null
  readonly expectedDate: string
  readonly receivedDate: string | null
  readonly items: ReadonlyArray<StockDeliveryConfirmationItem>
  readonly isSubmitting: boolean
  readonly onBack: () => void
  readonly onConfirm: () => void
}

export const StockDeliveryConfirmation = ({
  mode,
  sourceRef,
  expectedDate,
  receivedDate,
  items,
  isSubmitting,
  onBack,
  onConfirm,
}: StockDeliveryConfirmationProps): React.JSX.Element => (
  <section
    className={styles.confirmation}
    aria-labelledby="stock-delivery-confirmation-title"
  >
    <h3 id="stock-delivery-confirmation-title" className={styles.title}>
      {mode === 'cancel' ? '取消内容' : '受領内容'}
    </h3>
    <p className={styles.message}>
      {mode === 'cancel'
        ? 'meshi の入荷予定を取り消します。注文先への注文キャンセルは行いません。'
        : '表示した数量で配送全体の受領を確定します。'}
    </p>
    <dl className={styles.summary}>
      <div>
        <dt>注文番号</dt>
        <dd>{sourceRef ?? '注文番号の登録なし'}</dd>
      </div>
      <div>
        <dt>入荷予定日</dt>
        <dd>{expectedDate}</dd>
      </div>
      {mode === 'receive' && receivedDate !== null && (
        <div>
          <dt>受領日</dt>
          <dd>{receivedDate}</dd>
        </div>
      )}
    </dl>
    <ul className={styles.items}>
      {items.map((item) => (
        <li key={item.foodMasterId}>
          <span>{item.foodName}</span>
          <span>数量 {String(item.quantity)}</span>
        </li>
      ))}
    </ul>
    <div className={styles.actions}>
      <button
        type="button"
        className={styles.button}
        disabled={isSubmitting}
        onClick={onBack}
      >
        戻る
      </button>
      <button
        type="button"
        className={styles.button}
        data-primary="true"
        disabled={isSubmitting}
        onClick={onConfirm}
      >
        {isSubmitting
          ? '確定中…'
          : mode === 'cancel'
            ? 'この予定を取り消す'
            : '受領を確定'}
      </button>
    </div>
  </section>
)
