import type { MealType } from '#api/day-detail'
import styles from '#meal-log-sheet/MealLogDetailForm.module.css'
import {
  previewKcal,
  resolvedMealType,
  type SheetState,
} from '#meal-log-sheet/sheet-state'

const MEAL_OPTIONS: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '朝食' },
  { value: 'lunch', label: '昼食' },
  { value: 'dinner', label: '夕食' },
  { value: 'snack', label: '間食' },
]

export interface MealLogDetailFormProps {
  readonly state: SheetState
  readonly backToSearch: () => void
  readonly setQuantity: (quantity: string) => void
  readonly setUnit: (unit: string) => void
  readonly setMealType: (mealType: MealType) => void
  readonly setDate: (date: string) => void
  readonly setTime: (time: string) => void
}

export const MealLogDetailForm = ({
  state,
  backToSearch,
  setQuantity,
  setUnit,
  setMealType,
  setDate,
  setTime,
}: MealLogDetailFormProps): React.JSX.Element => {
  const { selectedFood } = state
  const kcal = previewKcal(state)
  const activeMealType = resolvedMealType(state)

  return (
    <div className={styles.form}>
      {state.isNewFood && (
        <div className={styles.newFoodNote}>
          新規食品としてマスタに追加されます · 栄養値は推定値
        </div>
      )}

      <div className={styles.selectedFood}>
        <span className={styles.selectedFoodName}>
          {selectedFood?.name ?? ''}
          {selectedFood?.isEstimated === true && (
            <span className={styles.estMark}> ~</span>
          )}
        </span>
        {state.mode === 'create' && (
          <button
            type="button"
            className={styles.changeButton}
            onClick={backToSearch}
          >
            変更
          </button>
        )}
      </div>

      <div className={styles.field}>
        <div className={styles.label}>量と単位</div>
        <div className={styles.quantityRow}>
          <input
            value={state.quantity}
            onChange={(e) => {
              setQuantity(e.target.value)
            }}
            inputMode="decimal"
            className={styles.quantityInput}
          />
          <input
            value={state.unit}
            onChange={(e) => {
              setUnit(e.target.value)
            }}
            className={styles.unitInput}
          />
        </div>
        <div className={styles.calcText}>
          {kcal === null ? '—' : `${String(Math.round(kcal))} kcal`}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>
          食事区分
          {state.mealType === null && (
            <span className={styles.hint}> (時刻から推定)</span>
          )}
        </div>
        <div className={styles.mealOptions}>
          {MEAL_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              className={
                activeMealType === option.value
                  ? styles.mealOptionActive
                  : styles.mealOption
              }
              onClick={() => {
                setMealType(option.value)
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.dateTimeRow}>
        <div className={styles.field}>
          <div className={styles.label}>日付</div>
          <input
            type="date"
            value={state.date}
            onChange={(e) => {
              setDate(e.target.value)
            }}
            className={styles.dateInput}
          />
        </div>
        <div className={styles.field}>
          <div className={styles.label}>時刻</div>
          <input
            type="time"
            value={state.time}
            onChange={(e) => {
              setTime(e.target.value)
            }}
            className={styles.timeInput}
          />
        </div>
      </div>
    </div>
  )
}
