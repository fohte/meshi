import { useEffect, useState } from 'react'

import styles from '#pages/settings/GoalWeightSection.module.css'

export interface GoalWeightSectionProps {
  goalWeightKg: number | null
  onSave: (goalWeightKg: number) => void
  onClear: () => void
  disabled?: boolean
}

const formatValue = (value: number | null): string =>
  value === null ? '' : String(value)

const parseGoalWeight = (value: string): number | null => {
  const trimmed = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null

  const parsed = Number(trimmed)
  return parsed >= 20 && parsed <= 300 ? parsed : null
}

export const GoalWeightSection = ({
  goalWeightKg,
  onSave,
  onClear,
  disabled = false,
}: GoalWeightSectionProps): React.JSX.Element => {
  const [draft, setDraft] = useState(() => formatValue(goalWeightKg))
  const parsed = parseGoalWeight(draft)
  const hasChanged = parsed !== goalWeightKg

  useEffect(() => {
    setDraft(formatValue(goalWeightKg))
  }, [goalWeightKg])

  return (
    <section className={styles.section}>
      <div className={styles.heading}>
        <span className={styles.hash}>##</span>
        <span>体重の目標</span>
      </div>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          if (parsed !== null && hasChanged) onSave(parsed)
        }}
      >
        <label className={styles.label} htmlFor="goal-weight-kg">
          目標体重
        </label>
        <div className={styles.controls}>
          <input
            id="goal-weight-kg"
            className={styles.input}
            type="text"
            inputMode="decimal"
            value={draft}
            aria-describedby="goal-weight-help"
            onChange={(event) => {
              setDraft(event.target.value)
            }}
            disabled={disabled}
          />
          <span className={styles.unit}>kg</span>
          <button
            type="submit"
            className={styles.button}
            disabled={disabled || parsed === null || !hasChanged}
          >
            保存
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={onClear}
            disabled={disabled || goalWeightKg === null}
          >
            削除
          </button>
        </div>
        <p id="goal-weight-help" className={styles.help}>
          20〜300 kg、小数点以下 2 桁まで
        </p>
        {draft.trim() !== '' && parsed === null ? (
          <p className={styles.error} role="alert">
            20〜300 kg の範囲で、小数点以下 2 桁まで入力してください。
          </p>
        ) : null}
      </form>
    </section>
  )
}
