import type { MealType } from '#api/day-detail'
import { DeleteConfirmDialog } from '#meal-log-sheet/DeleteConfirmDialog'
import { FoodSearchStep } from '#meal-log-sheet/FoodSearchStep'
import { MealLogDetailForm } from '#meal-log-sheet/MealLogDetailForm'
import styles from '#meal-log-sheet/MealLogSheet.module.css'
import type { SelectedFood, SheetState } from '#meal-log-sheet/sheet-state'

export interface MealLogSheetProps {
  readonly state: SheetState
  readonly close: () => void
  readonly setQuery: (query: string) => void
  readonly selectFood: (food: SelectedFood) => void
  readonly selectComposition: (compositionCode: string) => void
  readonly isRegisteringComposition: boolean
  readonly compositionError: boolean
  readonly backToSearch: () => void
  readonly setQuantity: (quantity: string) => void
  readonly setUnit: (unit: string) => void
  readonly setMealType: (mealType: MealType) => void
  readonly setDate: (date: string) => void
  readonly setTime: (time: string) => void
  readonly setNote: (note: string) => void
  readonly save: () => void
  readonly saveAndContinue: () => void
  readonly isSaving: boolean
  readonly saveError: boolean
  readonly confirmingDelete: boolean
  readonly requestDelete: () => void
  readonly cancelDelete: () => void
  readonly confirmDelete: () => void
  readonly isDeleting: boolean
  readonly deleteError: boolean
}

export const MealLogSheet = (props: MealLogSheetProps): React.JSX.Element => {
  const { state } = props
  const title = state.mode === 'edit' ? '記録を編集' : '食事を記録'
  const stepText =
    state.mode === 'create'
      ? state.phase === 'search'
        ? '1 / 2 食品を選ぶ'
        : '2 / 2 詳細を入力'
      : ''
  const canSave = state.selectedFood !== null && !props.isSaving
  const showContinue = state.mode === 'create' && state.phase === 'detail'

  return (
    <div className={styles.overlay}>
      <div className={styles.sheet}>
        <div className={styles.header}>
          <span className={styles.headerMark}>&gt;</span>
          <span className={styles.headerTitle}>{title}</span>
          {stepText !== '' && (
            <span className={styles.headerStep}>{stepText}</span>
          )}
          <button
            type="button"
            className={styles.closeButton}
            onClick={props.close}
          >
            ×
          </button>
        </div>

        <div className={styles.body}>
          {state.justSaved && (
            <div className={styles.savedMessage}>
              保存しました。続けて次の品目を選べます。
            </div>
          )}

          {state.phase === 'search' ? (
            <FoodSearchStep
              query={state.query}
              setQuery={props.setQuery}
              selectFood={props.selectFood}
              selectComposition={props.selectComposition}
              isRegisteringComposition={props.isRegisteringComposition}
              compositionError={props.compositionError}
            />
          ) : (
            <MealLogDetailForm
              state={state}
              backToSearch={props.backToSearch}
              setQuantity={props.setQuantity}
              setUnit={props.setUnit}
              setMealType={props.setMealType}
              setDate={props.setDate}
              setTime={props.setTime}
              setNote={props.setNote}
            />
          )}

          {props.saveError && (
            <div className={styles.errorMessage}>
              保存に失敗しました。入力内容を確認して再度お試しください。
            </div>
          )}
        </div>

        <div className={styles.footer}>
          {state.mode === 'edit' && (
            <button
              type="button"
              className={styles.deleteButton}
              onClick={props.requestDelete}
            >
              削除
            </button>
          )}
          <button
            type="button"
            className={styles.cancelButton}
            onClick={props.close}
          >
            キャンセル
          </button>
          {state.phase === 'detail' && (
            <button
              type="button"
              className={styles.saveButton}
              disabled={!canSave}
              onClick={props.save}
            >
              {state.mode === 'edit' ? '更新' : '保存'}
            </button>
          )}
          {showContinue && (
            <button
              type="button"
              className={styles.continueButton}
              disabled={!canSave}
              onClick={props.saveAndContinue}
            >
              続けてもう 1 品
            </button>
          )}
        </div>
      </div>

      {state.mode === 'edit' && props.confirmingDelete && (
        <DeleteConfirmDialog
          foodName={state.selectedFood?.name ?? ''}
          onCancel={props.cancelDelete}
          onConfirm={props.confirmDelete}
          isDeleting={props.isDeleting}
          error={props.deleteError}
        />
      )}
    </div>
  )
}
