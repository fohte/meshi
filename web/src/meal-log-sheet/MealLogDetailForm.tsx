import type { MealType } from '#api/day-detail'
import { MealTypeSelector } from '#components/MealTypeSelector/MealTypeSelector'
import { NutritionBasis } from '#components/NutritionBasis/NutritionBasis'
import styles from '#meal-log-sheet/MealLogDetailForm.module.css'
import { previewKcal, type SingleSheetState } from '#meal-log-sheet/sheet-state'

export interface MealLogDetailFormProps {
  readonly state: SingleSheetState
  readonly backToSearch: () => void
  readonly setQuantity: (quantity: string) => void
  readonly setMealType: (mealType: MealType) => void
  readonly setDate: (date: string) => void
}

export const MealLogDetailForm = ({
  state,
  backToSearch,
  setQuantity,
  setMealType,
  setDate,
}: MealLogDetailFormProps): React.JSX.Element => {
  const { selectedFood } = state
  const kcal = previewKcal(state)

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
        <div className={styles.label}>量</div>
        <div className={styles.quantityRow}>
          <input
            value={state.quantity}
            onChange={(e) => {
              setQuantity(e.target.value)
            }}
            inputMode="decimal"
            className={styles.quantityInput}
          />
        </div>
        <div className={styles.calcText}>
          {kcal === null ? '—' : `${String(Math.round(kcal))} kcal`}
        </div>
      </div>

      <div className={styles.field}>
        <div className={styles.label}>食事区分</div>
        <MealTypeSelector
          value={state.mealType}
          disabled={false}
          onChange={setMealType}
        />
      </div>

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

      {state.mode === 'edit' && (
        <NutritionBasis
          nutritionVersion={state.nutritionVersion}
          nutritionVersionOrigin={state.nutritionVersionOrigin}
          nutritionVersionDifferences={state.nutritionVersionDifferences}
        />
      )}
    </div>
  )
}
