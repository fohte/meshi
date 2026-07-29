import { useEffect, useState } from 'react'

import styles from '#pages/settings/NutrientTargetRow.module.css'

export interface NutrientTargetRowProps {
  label: string
  unit: string
  value: number | undefined
  onCommit: (value: number) => void
  disabled?: boolean
}

const formatValue = (value: number | undefined): string =>
  value === undefined ? '' : String(value)

export const NutrientTargetRow = ({
  label,
  unit,
  value,
  onCommit,
  disabled = false,
}: NutrientTargetRowProps): React.JSX.Element => {
  const [draft, setDraft] = useState(() => formatValue(value))

  // Keeps the input in sync when the server value changes (e.g. after a
  // successful save), without fighting the user's in-progress edit — this
  // only fires between renders, never while the user is actively typing.
  useEffect(() => {
    setDraft(formatValue(value))
  }, [value])

  const commit = (): void => {
    const trimmed = draft.trim()
    const parsed = trimmed === '' ? undefined : Number(trimmed)
    // Clearing the field or entering something unparsable just resets the
    // input to the last saved value: the domain layer has no "clear a single
    // nutrient" operation, only whole-profile replace, so there's nothing to
    // persist here.
    if (parsed === undefined || Number.isNaN(parsed) || parsed === value) {
      setDraft(formatValue(value))
      return
    }
    onCommit(parsed)
  }

  return (
    <div className={styles.row}>
      <span className={styles.label}>{label}</span>
      <input
        className={styles.input}
        value={draft}
        inputMode="decimal"
        onChange={(e) => {
          setDraft(e.target.value)
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        disabled={disabled}
      />
      <span className={styles.unit}>{unit}</span>
    </div>
  )
}
