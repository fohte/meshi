import { useMemo, useState } from 'react'

import type { NutrientDefinition } from '#api/nutrient-definitions'
import { NutrientTargetRow } from '#pages/settings/NutrientTargetRow'
import styles from '#pages/settings/NutritionTargetsSection.module.css'

export interface NutritionTargetsSectionProps {
  definitions: ReadonlyArray<NutrientDefinition>
  dailyTargets: Record<string, number> | null
  onCommit: (code: string, value: number) => void
  disabled?: boolean
}

export const NutritionTargetsSection = ({
  definitions,
  dailyTargets,
  onCommit,
  disabled = false,
}: NutritionTargetsSectionProps): React.JSX.Element => {
  // Extra rows the user opened via "+ 栄養素を追加" for a nutrient that has
  // no saved target yet; once a value is committed the row also matches
  // `hasTarget` below, so this only needs to track the not-yet-saved case.
  const [addedCodes, setAddedCodes] = useState<ReadonlySet<string>>(new Set())
  const [isPickerOpen, setIsPickerOpen] = useState(false)

  const visibleDefinitions = useMemo(
    () =>
      definitions.filter(
        (def) =>
          def.isMajor ||
          dailyTargets?.[def.code] !== undefined ||
          addedCodes.has(def.code),
      ),
    [definitions, dailyTargets, addedCodes],
  )

  const hiddenDefinitions = useMemo(
    () =>
      definitions.filter(
        (def) => !visibleDefinitions.some((v) => v.code === def.code),
      ),
    [definitions, visibleDefinitions],
  )

  return (
    <div>
      <div className={styles.table}>
        {visibleDefinitions.map((def) => (
          <NutrientTargetRow
            key={def.code}
            label={def.displayName}
            unit={def.unit}
            value={dailyTargets?.[def.code]}
            onCommit={(value) => {
              onCommit(def.code, value)
            }}
            disabled={disabled}
          />
        ))}
      </div>

      {isPickerOpen ? (
        <select
          className={styles.picker}
          autoFocus
          defaultValue=""
          onChange={(e) => {
            const code = e.target.value
            if (code !== '') {
              setAddedCodes((prev) => new Set(prev).add(code))
            }
            setIsPickerOpen(false)
          }}
          onBlur={() => {
            setIsPickerOpen(false)
          }}
        >
          <option value="" disabled>
            栄養素を選択
          </option>
          {hiddenDefinitions.map((def) => (
            <option key={def.code} value={def.code}>
              {def.displayName}
            </option>
          ))}
        </select>
      ) : (
        <button
          type="button"
          className={styles.addButton}
          onClick={() => {
            setIsPickerOpen(true)
          }}
          disabled={disabled || hiddenDefinitions.length === 0}
        >
          + 栄養素を追加
        </button>
      )}
    </div>
  )
}
