import type { StockStatus } from '#api/stock'
import type { StockCountInput } from '#api/stock-counts'
import styles from '#components/Stock/StockCountForm.module.css'

type StockCountFormItem = Pick<
  StockStatus['stockItems'][number],
  'foodMasterId' | 'foodName' | 'totalQuantity'
>

export interface StockCountFormProps {
  readonly stockItems: ReadonlyArray<StockCountFormItem>
  readonly foodMasterId: string
  readonly quantity: string
  readonly receivedDate: string
  readonly bestBefore: string
  readonly isSaving: boolean
  readonly error?: string | undefined
  readonly onFoodMasterIdChange: (foodMasterId: string) => void
  readonly onQuantityChange: (quantity: string) => void
  readonly onReceivedDateChange: (date: string) => void
  readonly onBestBeforeChange: (date: string) => void
  readonly onSubmit: (input: StockCountInput) => void
}

const formatQuantity = (quantity: number): string =>
  new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 20 }).format(quantity)

export const StockCountForm = ({
  stockItems,
  foodMasterId,
  quantity,
  receivedDate,
  bestBefore,
  isSaving,
  error,
  onFoodMasterIdChange,
  onQuantityChange,
  onReceivedDateChange,
  onBestBeforeChange,
  onSubmit,
}: StockCountFormProps): React.JSX.Element | null => {
  if (stockItems.length === 0) return null

  const selectedItem = stockItems.find(
    (item) => item.foodMasterId === foodMasterId,
  )
  const parsedQuantity = quantity.trim() === '' ? Number.NaN : Number(quantity)
  const canSubmit =
    selectedItem !== undefined &&
    Number.isFinite(parsedQuantity) &&
    parsedQuantity >= 0

  return (
    <form
      className={styles.form}
      aria-label="棚卸しを記録"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return

        onSubmit({
          foodMasterId: selectedItem.foodMasterId,
          quantity: parsedQuantity,
          ...(receivedDate === '' ? {} : { receivedDate }),
          ...(bestBefore === '' ? {} : { bestBefore }),
        })
      }}
    >
      <fieldset className={styles.fieldset} disabled={isSaving}>
        <legend className={styles.title}>棚卸しを記録</legend>

        <label className={styles.field}>
          <span className={styles.label}>食品</span>
          <select
            className={styles.input}
            value={foodMasterId}
            onChange={(event) => {
              onFoodMasterIdChange(event.currentTarget.value)
            }}
          >
            {stockItems.map((item) => (
              <option key={item.foodMasterId} value={item.foodMasterId}>
                {item.foodName}
              </option>
            ))}
          </select>
        </label>

        {selectedItem !== undefined && (
          <div className={styles.referenceQuantity}>
            <span>記録上の残数 (参照)</span>
            <output htmlFor="stock-count-quantity">
              {formatQuantity(selectedItem.totalQuantity)}
            </output>
          </div>
        )}

        <label className={styles.field}>
          <span className={styles.label}>今、数えた実数</span>
          <input
            id="stock-count-quantity"
            className={styles.input}
            aria-label="今、数えた実数"
            type="number"
            min="0"
            step="any"
            required
            inputMode="decimal"
            value={quantity}
            onChange={(event) => {
              onQuantityChange(event.currentTarget.value)
            }}
          />
        </label>

        <div className={styles.optionalFields}>
          <label className={styles.field}>
            <span className={styles.label}>増加分の受領日 (任意)</span>
            <input
              className={styles.input}
              aria-label="増加分の受領日 (任意)"
              type="date"
              value={receivedDate}
              onChange={(event) => {
                onReceivedDateChange(event.currentTarget.value)
              }}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.label}>増加分の賞味期限 (任意)</span>
            <input
              className={styles.input}
              aria-label="増加分の賞味期限 (任意)"
              type="date"
              value={bestBefore}
              onChange={(event) => {
                onBestBeforeChange(event.currentTarget.value)
              }}
            />
          </label>
        </div>
        <div className={styles.hint}>日付は新たな入荷分に適用されます。</div>

        {error !== undefined && (
          <div className={styles.error} role="alert">
            {error}
          </div>
        )}

        <button
          className={styles.submitButton}
          type="submit"
          disabled={isSaving || !canSubmit}
        >
          {isSaving ? '記録中…' : '実数を記録'}
        </button>
      </fieldset>
    </form>
  )
}
