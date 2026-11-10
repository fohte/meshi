import type { MealType } from '#api/day-detail'
import { MealPlanItems } from '#components/MealPlanItems/MealPlanItems'
import styles from '#components/MealSetRecordForm/MealSetRecordForm.module.css'
import { MealTypeSelector } from '#components/MealTypeSelector/MealTypeSelector'

interface MealSetRecordFormItem {
  readonly id: number
  readonly foodName: string
  readonly quantity: string
  readonly energyKcalPerUnit: number | null
}

export interface MealSetRecordFormProps {
  readonly mealSetName: string
  readonly items: ReadonlyArray<MealSetRecordFormItem>
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

    <MealPlanItems
      items={items}
      isSaving={isSaving}
      onQuantityChange={onQuantityChange}
      onRemoveItem={onRemoveItem}
      onReplaceItem={onReplaceItem}
      onAddItem={onAddItem}
    />

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
