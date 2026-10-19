import type {
  PlannedDelivery,
  StockDeliveryEditorMode,
  StockDeliveryEditorViewProps,
  StockItem,
} from '#components/Stock/stock-delivery-editor-types'
import { StockDeliveryConfirmation } from '#components/Stock/StockDeliveryConfirmation'
import styles from '#components/Stock/StockDeliveryEditor.module.css'

const modeTitle = (mode: StockDeliveryEditorMode): string => {
  switch (mode) {
    case 'create':
      return '入荷予定を登録'
    case 'edit':
      return '入荷予定を変更'
    case 'cancel':
      return '入荷予定を取り消す'
    case 'receive':
      return '入荷を受領する'
  }
}

const foodNameFor = (
  foodMasterId: string,
  stockItems: ReadonlyArray<StockItem>,
  delivery: PlannedDelivery | null,
): string =>
  stockItems.find((item) => item.foodMasterId === foodMasterId)?.foodName ??
  delivery?.items.find((item) => item.foodMasterId === foodMasterId)
    ?.foodName ??
  '不明な食品'

export const StockDeliveryEditorView = ({
  mode,
  delivery,
  stockItems,
  isSubmitting,
  error,
  draft,
  isConfirming,
  validationError,
  onClose,
  onDraftChange,
  onItemChange,
  onAddItem,
  onRemoveItem,
  onFormSubmit,
  onConfirmationBack,
  onConfirmationConfirm,
}: StockDeliveryEditorViewProps): React.JSX.Element => {
  const options = [
    ...stockItems.map((item) => ({
      foodMasterId: item.foodMasterId,
      foodName: item.foodName,
    })),
    ...(delivery?.items ?? [])
      .filter(
        (deliveryItem) =>
          !stockItems.some(
            (stockItem) => stockItem.foodMasterId === deliveryItem.foodMasterId,
          ),
      )
      .map((item) => ({
        foodMasterId: item.foodMasterId,
        foodName: item.foodName,
      })),
  ]
  const confirmationMode = mode === 'cancel' || mode === 'receive' ? mode : null
  const isConfirmation =
    confirmationMode === 'cancel' ||
    (isConfirming && confirmationMode === 'receive')
  const title = modeTitle(mode)

  return (
    <section
      className={styles.editor}
      aria-labelledby="stock-delivery-editor-title"
    >
      <header className={styles.header}>
        <h2 id="stock-delivery-editor-title" className={styles.title}>
          <span className={styles.marker}>##</span>
          {isConfirmation ? `${title}の確認` : title}
        </h2>
        <button
          type="button"
          className={styles.closeButton}
          aria-label="配送の編集を閉じる"
          disabled={isSubmitting}
          onClick={onClose}
        >
          ×
        </button>
      </header>

      {mode === 'cancel' && delivery === null ? (
        <p className={styles.error} role="alert">
          対象の入荷予定がありません。
        </p>
      ) : isConfirmation && delivery !== null ? (
        <StockDeliveryConfirmation
          mode={confirmationMode}
          sourceRef={delivery.sourceRef}
          expectedDate={delivery.expectedDate}
          receivedDate={
            confirmationMode === 'receive' ? draft.receivedDate : null
          }
          items={
            confirmationMode === 'cancel'
              ? delivery.items
              : draft.items.map((item) => ({
                  foodMasterId: item.foodMasterId,
                  foodName: foodNameFor(
                    item.foodMasterId,
                    stockItems,
                    delivery,
                  ),
                  quantity: Number(item.quantity),
                }))
          }
          isSubmitting={isSubmitting}
          onBack={onConfirmationBack}
          onConfirm={onConfirmationConfirm}
        />
      ) : (
        <form className={styles.form} onSubmit={onFormSubmit}>
          {mode === 'receive' ? (
            <>
              <label
                className={styles.label}
                htmlFor="stock-delivery-received-date"
              >
                受領日
              </label>
              <input
                id="stock-delivery-received-date"
                className={styles.input}
                type="date"
                required
                value={draft.receivedDate}
                disabled={isSubmitting}
                onChange={(event) => {
                  onDraftChange({ receivedDate: event.currentTarget.value })
                }}
              />
              <h3 className={styles.itemsTitle}>受領した数量</h3>
              <ul className={styles.receiptItems}>
                {draft.items.map((item, index) => (
                  <li key={item.foodMasterId}>
                    <span>
                      {foodNameFor(item.foodMasterId, stockItems, delivery)}
                    </span>
                    <label className={styles.quantityLabel}>
                      数量
                      <input
                        className={styles.quantityInput}
                        type="number"
                        min="0"
                        step="any"
                        required
                        aria-label={`${foodNameFor(item.foodMasterId, stockItems, delivery)} の受領数量`}
                        value={item.quantity}
                        disabled={isSubmitting}
                        onChange={(event) => {
                          onItemChange(index, {
                            quantity: event.currentTarget.value,
                          })
                        }}
                      />
                    </label>
                  </li>
                ))}
              </ul>
              <p className={styles.hint}>
                数量に 0 を入力すると、現在庫には加算せず配送を確定します。
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  閉じる
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isSubmitting}
                >
                  受領内容を確認
                </button>
              </div>
            </>
          ) : (
            <>
              <label
                className={styles.label}
                htmlFor="stock-delivery-source-ref"
              >
                注文番号
              </label>
              <input
                id="stock-delivery-source-ref"
                className={styles.input}
                required
                value={draft.sourceRef}
                readOnly={mode === 'edit'}
                disabled={isSubmitting}
                onChange={(event) => {
                  onDraftChange({ sourceRef: event.currentTarget.value })
                }}
              />
              <label
                className={styles.label}
                htmlFor="stock-delivery-expected-date"
              >
                入荷予定日
              </label>
              <input
                id="stock-delivery-expected-date"
                className={styles.input}
                type="date"
                required
                value={draft.expectedDate}
                disabled={isSubmitting}
                onChange={(event) => {
                  onDraftChange({ expectedDate: event.currentTarget.value })
                }}
              />
              <label
                className={styles.label}
                htmlFor="stock-delivery-change-deadline"
              >
                変更締切 (任意)
              </label>
              <input
                id="stock-delivery-change-deadline"
                className={styles.input}
                type="date"
                value={draft.changeDeadline}
                disabled={isSubmitting}
                onChange={(event) => {
                  onDraftChange({ changeDeadline: event.currentTarget.value })
                }}
              />
              <div className={styles.itemsHeader}>
                <h3 className={styles.itemsTitle}>食品と予定数量</h3>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={isSubmitting || stockItems.length === 0}
                  onClick={onAddItem}
                >
                  食品を追加
                </button>
              </div>
              {stockItems.length === 0 ? (
                <p className={styles.hint}>在庫対象の食品がありません。</p>
              ) : (
                <ul className={styles.editItems}>
                  {draft.items.map((item, index) => (
                    <li key={`${item.foodMasterId}:${String(index)}`}>
                      <label className={styles.itemLabel}>
                        <span>食品</span>
                        <select
                          className={styles.input}
                          required
                          value={item.foodMasterId}
                          disabled={isSubmitting}
                          onChange={(event) => {
                            onItemChange(index, {
                              foodMasterId: event.currentTarget.value,
                            })
                          }}
                        >
                          <option value="">食品を選択</option>
                          {options.map((option) => (
                            <option
                              key={option.foodMasterId}
                              value={option.foodMasterId}
                              disabled={draft.items.some(
                                (other, otherIndex) =>
                                  otherIndex !== index &&
                                  other.foodMasterId === option.foodMasterId,
                              )}
                            >
                              {option.foodName}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className={styles.quantityLabel}>
                        数量
                        <input
                          className={styles.quantityInput}
                          type="number"
                          step="any"
                          required
                          aria-label={`${String(index + 1)} 件目の予定数量`}
                          value={item.quantity}
                          disabled={isSubmitting}
                          onChange={(event) => {
                            onItemChange(index, {
                              quantity: event.currentTarget.value,
                            })
                          }}
                        />
                      </label>
                      <button
                        type="button"
                        className={styles.removeButton}
                        aria-label={`${String(index + 1)} 件目の食品を削除`}
                        disabled={isSubmitting || draft.items.length < 2}
                        onClick={() => {
                          onRemoveItem(index)
                        }}
                      >
                        削除
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  disabled={isSubmitting}
                  onClick={onClose}
                >
                  閉じる
                </button>
                <button
                  type="submit"
                  className={styles.primaryButton}
                  disabled={isSubmitting || stockItems.length === 0}
                >
                  {isSubmitting
                    ? '保存中…'
                    : mode === 'create'
                      ? '予定を登録'
                      : '変更を保存'}
                </button>
              </div>
            </>
          )}
        </form>
      )}

      {(validationError ?? error) !== undefined && (
        <p className={styles.error} role="alert">
          {validationError ?? error}
        </p>
      )}
    </section>
  )
}
