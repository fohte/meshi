import type { MealType } from '#api/day-detail'
import type { MealSet } from '#api/meal-sets'
import { MealSetPicker } from '#components/MealSetPicker/MealSetPicker'
import { MealSetRecordForm } from '#components/MealSetRecordForm/MealSetRecordForm'
import { DeleteConfirmDialog } from '#meal-log-sheet/DeleteConfirmDialog'
import { FoodSearchStep } from '#meal-log-sheet/FoodSearchStep'
import { MealLogDetailForm } from '#meal-log-sheet/MealLogDetailForm'
import styles from '#meal-log-sheet/MealLogSheet.module.css'
import {
  buildMealSetSavePayload,
  buildSavePayload,
  type SelectedFood,
  type SheetState,
} from '#meal-log-sheet/sheet-state'

const sheetTitle = (state: SheetState): string => {
  if (state.mode === 'edit') return '記録を編集'
  if (state.mode === 'meal-set') return 'マイセットを記録'
  return '食事を記録'
}

const sheetStepText = (state: SheetState): string => {
  if (state.mode === 'create') {
    if (state.phase === 'search') return '1 / 2 食品を選ぶ'
    return '2 / 2 詳細を入力'
  }
  if (state.mode !== 'meal-set') return ''
  if (state.pendingSelection === null) return '品目を確認'
  if (state.pendingSelection.type === 'add') return '品目を追加'
  return '品目を変更'
}

const saveButtonLabel = (state: SheetState): string => {
  if (state.mode === 'meal-set') return 'まとめて記録'
  if (state.mode === 'edit') return '更新'
  return '保存'
}

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
  readonly setMealType: (mealType: MealType) => void
  readonly setDate: (date: string) => void
  readonly setCreateTab: (tab: 'food' | 'meal-set') => void
  readonly mealSets: ReadonlyArray<MealSet>
  readonly isMealSetsLoading: boolean
  readonly mealSetsError: string | undefined
  readonly selectMealSet: (mealSet: MealSet) => void
  readonly setMealSetItemQuantity: (itemId: number, quantity: string) => void
  readonly removeMealSetItem: (itemId: number) => void
  readonly replaceMealSetItem: (itemId: number) => void
  readonly addMealSetItem: () => void
  readonly save: () => void
  readonly saveAndContinue: () => void
  readonly isSaving: boolean
  readonly saveError: string | null
  readonly confirmingDelete: boolean
  readonly requestDelete: () => void
  readonly cancelDelete: () => void
  readonly confirmDelete: () => void
  readonly isDeleting: boolean
  readonly deleteError: boolean
}

export const MealLogSheet = (props: MealLogSheetProps): React.JSX.Element => {
  const { state } = props
  const isMealSet = state.mode === 'meal-set'
  const isDetail = isMealSet
    ? state.pendingSelection === null
    : state.phase === 'detail'
  const title = sheetTitle(state)
  const stepText = sheetStepText(state)
  const foodSearchStep = (
    <FoodSearchStep
      query={state.query}
      setQuery={props.setQuery}
      selectFood={props.selectFood}
      selectComposition={props.selectComposition}
      isRegisteringComposition={props.isRegisteringComposition}
      compositionError={props.compositionError}
    />
  )
  const canSave =
    (isMealSet ? buildMealSetSavePayload(state) : buildSavePayload(state)) !==
      null && !props.isSaving
  const showContinue = state.mode === 'create' && state.phase === 'detail'
  const showCreateTabs = state.mode === 'create' && state.phase === 'search'

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
          {state.mode === 'create' && state.justSaved && (
            <div className={styles.savedMessage}>
              保存しました。続けて次の品目を選べます。
            </div>
          )}

          {isMealSet ? (
            state.pendingSelection === null ? (
              <MealSetRecordForm
                mealSetName={state.mealSetName}
                items={state.items}
                date={state.date}
                mealType={state.mealType}
                isSaving={props.isSaving}
                error={props.saveError ?? undefined}
                onQuantityChange={props.setMealSetItemQuantity}
                onRemoveItem={props.removeMealSetItem}
                onReplaceItem={props.replaceMealSetItem}
                onAddItem={props.addMealSetItem}
                onMealTypeChange={props.setMealType}
                onDateChange={props.setDate}
              />
            ) : (
              <>
                <div className={styles.searchBack}>
                  <span>
                    {state.pendingSelection.type === 'add'
                      ? '追加する食品を選んでください'
                      : '差し替える食品を選んでください'}
                  </span>
                  <button type="button" onClick={props.backToSearch}>
                    マイセットに戻る
                  </button>
                </div>
                {foodSearchStep}
              </>
            )
          ) : state.phase === 'search' ? (
            <>
              {showCreateTabs && (
                <div className={styles.tabs} role="group" aria-label="記録方法">
                  <button
                    type="button"
                    aria-pressed={state.activeTab === 'food'}
                    className={
                      state.activeTab === 'food' ? styles.tabActive : styles.tab
                    }
                    onClick={() => {
                      props.setCreateTab('food')
                    }}
                  >
                    食品
                  </button>
                  <button
                    type="button"
                    aria-pressed={state.activeTab === 'meal-set'}
                    className={
                      state.activeTab === 'meal-set'
                        ? styles.tabActive
                        : styles.tab
                    }
                    onClick={() => {
                      props.setCreateTab('meal-set')
                    }}
                  >
                    マイセット
                  </button>
                </div>
              )}
              {state.mode === 'create' && state.activeTab === 'meal-set' ? (
                <MealSetPicker
                  mealSets={props.mealSets}
                  isLoading={props.isMealSetsLoading}
                  error={props.mealSetsError}
                  onSelect={props.selectMealSet}
                />
              ) : (
                foodSearchStep
              )}
            </>
          ) : (
            <MealLogDetailForm
              state={state}
              backToSearch={props.backToSearch}
              setQuantity={props.setQuantity}
              setMealType={props.setMealType}
              setDate={props.setDate}
            />
          )}

          {props.saveError !== null && !isMealSet && (
            <div className={styles.errorMessage}>{props.saveError}</div>
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
          {isDetail && (
            <button
              type="button"
              className={styles.saveButton}
              disabled={!canSave}
              onClick={props.save}
            >
              {saveButtonLabel(state)}
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
