import type { MealType } from '#api/day-detail'
import { MealPlanItems } from '#components/MealPlanItems/MealPlanItems'
import styles from '#components/MealPlanSheet/MealPlanSheet.module.css'
import { MEAL_LABELS } from '#components/MealTimeline/build-meal-timeline-groups'
import type {
  EditableFoodItem,
  FoodItemSelection,
  SelectedFood,
} from '#meal-log-sheet/food-item-list'
import { FoodSearchStep } from '#meal-log-sheet/FoodSearchStep'

export type MealPlanDraftItem = EditableFoodItem

export interface MealPlanSheetProps {
  readonly date: string
  readonly mealType: MealType
  readonly isEditing: boolean
  readonly reason: string
  readonly items: ReadonlyArray<MealPlanDraftItem>
  readonly selection: FoodItemSelection | null
  readonly query: string
  readonly isSaving: boolean
  readonly error: string | null
  readonly isRegisteringComposition: boolean
  readonly compositionError: boolean
  readonly close: () => void
  readonly setReason: (reason: string) => void
  readonly setQuery: (query: string) => void
  readonly selectFood: (food: SelectedFood) => void
  readonly selectComposition: (compositionCode: string) => void
  readonly backToItems: () => void
  readonly setQuantity: (id: number, quantity: string) => void
  readonly removeItem: (id: number) => void
  readonly replaceItem: (id: number) => void
  readonly addItem: () => void
  readonly save: () => void
}

const canSave = (items: ReadonlyArray<MealPlanDraftItem>): boolean =>
  items.length > 0 &&
  items.every((item) => {
    const quantity = Number(item.quantity)
    return Number.isFinite(quantity) && quantity > 0
  })

export const MealPlanSheet = (props: MealPlanSheetProps): React.JSX.Element => (
  <div className={styles.overlay}>
    <section
      className={styles.sheet}
      role="dialog"
      aria-modal="true"
      aria-label={props.isEditing ? '予定を変更' : '予定を立てる'}
    >
      <header className={styles.header}>
        <span className={styles.mark}>&gt;</span>
        <h2>{props.isEditing ? '予定を変更' : '予定を立てる'}</h2>
        <button
          type="button"
          className={styles.close}
          onClick={props.close}
          aria-label="閉じる"
        >
          ×
        </button>
      </header>
      <div className={styles.body}>
        <div className={styles.slot}>
          {props.date} · {MEAL_LABELS[props.mealType]}
        </div>
        {props.selection === null ? (
          <>
            <MealPlanItems
              items={props.items}
              isSaving={props.isSaving}
              onQuantityChange={props.setQuantity}
              onRemoveItem={props.removeItem}
              onReplaceItem={props.replaceItem}
              onAddItem={props.addItem}
            />
            <label className={styles.reasonField}>
              <span>予定の理由</span>
              <textarea
                value={props.reason}
                rows={2}
                disabled={props.isSaving}
                onChange={(event) => {
                  props.setReason(event.currentTarget.value)
                }}
              />
            </label>
          </>
        ) : (
          <>
            <div className={styles.searchBack}>
              <span>
                {props.selection.type === 'add'
                  ? '追加する食品を選んでください'
                  : '差し替える食品を選んでください'}
              </span>
              <button
                type="button"
                onClick={() => {
                  props.backToItems()
                }}
              >
                予定に戻る
              </button>
            </div>
            <FoodSearchStep
              query={props.query}
              setQuery={props.setQuery}
              selectFood={props.selectFood}
              selectComposition={props.selectComposition}
              isRegisteringComposition={props.isRegisteringComposition}
              compositionError={props.compositionError}
            />
          </>
        )}
        {props.error !== null && (
          <div className={styles.error} role="alert">
            {props.error}
          </div>
        )}
      </div>
      <footer className={styles.footer}>
        <button type="button" className={styles.cancel} onClick={props.close}>
          キャンセル
        </button>
        {props.selection === null && (
          <button
            type="button"
            className={styles.save}
            disabled={!canSave(props.items) || props.isSaving}
            onClick={props.save}
          >
            保存
          </button>
        )}
      </footer>
    </section>
  </div>
)
