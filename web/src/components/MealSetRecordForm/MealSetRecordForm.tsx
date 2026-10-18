import type { MealType } from '#api/day-detail'
import styles from '#components/MealSetRecordForm/MealSetRecordForm.module.css'
import { MealTypeSelector } from '#components/MealTypeSelector/MealTypeSelector'
import type { MealSetRecordItem } from '#meal-log-sheet/sheet-state'

export interface MealSetRecordFormProps {
  readonly mealSetName: string
  readonly items: ReadonlyArray<MealSetRecordItem>
  readonly date: string
  readonly mealType: MealType | null
  readonly isSaving: boolean
  readonly error?: string | undefined
  readonly onQuantityChange: (itemId: number, quantity: string) => void
  readonly onRemoveItem: (itemId: number) => void
  readonly onReplaceItem: (itemId: number) => void
  readonly onAddItem: () => void
  readonly onMealTypeChange: (mealType: MealType) => void
  readonly onDateChange: (date: string) => void
}

const itemKcalText = (item: MealSetRecordItem): string => {
  if (item.energyKcalPerUnit === null) return '—'
  const quantity = Number(item.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return '—'
  return `${String(Math.round(item.energyKcalPerUnit * quantity))} kcal`
}

export const MealSetRecordForm = ({
  mealSetName,
  items,
  date,
  mealType,
  isSaving,
  error,
  onQuantityChange,
  onRemoveItem,
  onReplaceItem,
  onAddItem,
  onMealTypeChange,
  onDateChange,
}: MealSetRecordFormProps): React.JSX.Element => (
  <div className={styles.form}>
    <div className={styles.setName}>{mealSetName}</div>

    <div className={styles.field}>
      <div className={styles.itemsHeader}>
        <div className={styles.label}>品目と量</div>
        <span className={styles.hint}>量は食品 1 つ分への倍率です</span>
      </div>
      {items.length === 0 ? (
        <div className={styles.empty}>品目を追加してください。</div>
      ) : (
        <ul className={styles.items}>
          {items.map((item) => (
            <li key={item.id} className={styles.item}>
              <span className={styles.foodName}>{item.foodName}</span>
              <div className={styles.itemActions}>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  disabled={isSaving}
                  aria-label={`${item.foodName} の量`}
                  className={styles.quantityInput}
                  onChange={(event) => {
                    onQuantityChange(item.id, event.currentTarget.value)
                  }}
                />
                <span className={styles.multiplier} aria-hidden="true">
                  ×
                </span>
                <span className={styles.kcal}>{itemKcalText(item)}</span>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={isSaving}
                  aria-label={`${item.foodName} を差し替え`}
                  onClick={() => {
                    onReplaceItem(item.id)
                  }}
                >
                  変更
                </button>
                <button
                  type="button"
                  className={styles.actionButton}
                  disabled={isSaving}
                  aria-label={`${item.foodName} を削除`}
                  onClick={() => {
                    onRemoveItem(item.id)
                  }}
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        className={styles.addButton}
        disabled={isSaving}
        onClick={onAddItem}
      >
        + 食品を追加
      </button>
    </div>

    <div className={styles.field}>
      <div className={styles.label}>食事区分</div>
      <MealTypeSelector
        value={mealType}
        disabled={isSaving}
        onChange={onMealTypeChange}
      />
    </div>

    <label className={styles.field}>
      <span className={styles.label}>日付</span>
      <input
        type="date"
        value={date}
        disabled={isSaving}
        className={styles.dateInput}
        onChange={(event) => {
          onDateChange(event.currentTarget.value)
        }}
      />
    </label>

    {error !== undefined && (
      <div className={styles.error} role="alert">
        {error}
      </div>
    )}
  </div>
)
