import type { MealType } from '#api/day-detail'
import styles from '#components/MealTypeSelector/MealTypeSelector.module.css'

const MEAL_OPTIONS: ReadonlyArray<{ value: MealType; label: string }> = [
  { value: 'breakfast', label: '朝食' },
  { value: 'lunch', label: '昼食' },
  { value: 'dinner', label: '夕食' },
  { value: 'snack', label: '間食' },
]

export interface MealTypeSelectorProps {
  readonly value: MealType | null
  readonly disabled: boolean
  readonly onChange: (mealType: MealType) => void
}

export const MealTypeSelector = ({
  value,
  disabled,
  onChange,
}: MealTypeSelectorProps): React.JSX.Element => (
  <div className={styles.options} role="group" aria-label="食事区分">
    {MEAL_OPTIONS.map((option) => (
      <button
        key={option.value}
        type="button"
        aria-pressed={value === option.value}
        className={value === option.value ? styles.optionActive : styles.option}
        disabled={disabled}
        onClick={() => {
          onChange(option.value)
        }}
      >
        {option.label}
      </button>
    ))}
  </div>
)
