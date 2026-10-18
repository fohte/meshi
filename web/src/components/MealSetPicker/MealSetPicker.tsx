import type { MealSet } from '#api/meal-sets'
import styles from '#components/MealSetPicker/MealSetPicker.module.css'

export interface MealSetPickerProps {
  readonly mealSets: ReadonlyArray<MealSet>
  readonly isLoading: boolean
  readonly error?: string | undefined
  readonly onSelect: (mealSet: MealSet) => void
}

export const MealSetPicker = ({
  mealSets,
  isLoading,
  error,
  onSelect,
}: MealSetPickerProps): React.JSX.Element => {
  if (isLoading) {
    return <div className={styles.status}>マイセットを読み込んでいます...</div>
  }

  if (error !== undefined) {
    return (
      <div className={styles.error} role="alert">
        {error}
      </div>
    )
  }

  if (mealSets.length === 0) {
    return (
      <div className={styles.status}>保存済みのマイセットはありません。</div>
    )
  }

  return (
    <ul className={styles.list}>
      {mealSets.map((mealSet) => (
        <li key={mealSet.id}>
          <button
            type="button"
            className={styles.option}
            onClick={() => {
              onSelect(mealSet)
            }}
          >
            <span className={styles.name}>{mealSet.name}</span>
            <span className={styles.items}>
              {mealSet.items
                .map((item) => `${item.foodName} × ${String(item.quantity)}`)
                .join(' · ')}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
