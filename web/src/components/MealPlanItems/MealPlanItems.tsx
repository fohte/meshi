import styles from '#components/MealPlanItems/MealPlanItems.module.css'

interface EditableMealItem<ItemId extends string | number = string | number> {
  readonly id: ItemId
  readonly foodName: string
  readonly quantity: string
  readonly energyKcalPerUnit: number | null
}

export interface MealPlanItemsProps<
  ItemId extends string | number = string | number,
> {
  readonly items: ReadonlyArray<EditableMealItem<ItemId>>
  readonly isSaving: boolean
  readonly onQuantityChange: (itemId: ItemId, quantity: string) => void
  readonly onRemoveItem: (itemId: ItemId) => void
  readonly onReplaceItem: (itemId: ItemId) => void
  readonly onAddItem: () => void
}

const itemKcalText = (item: EditableMealItem): string => {
  if (item.energyKcalPerUnit === null) return '—'
  const quantity = Number(item.quantity)
  if (!Number.isFinite(quantity) || quantity <= 0) return '—'
  return `${String(Math.round(item.energyKcalPerUnit * quantity))} kcal`
}

export const MealPlanItems = <ItemId extends string | number>({
  items,
  isSaving,
  onQuantityChange,
  onRemoveItem,
  onReplaceItem,
  onAddItem,
}: MealPlanItemsProps<ItemId>): React.JSX.Element => (
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
)
