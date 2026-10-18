import styles from '#components/MealSetSaveForm/MealSetSaveForm.module.css'

export interface MealSetSaveFormProps {
  readonly id: string
  readonly mealLabel: string
  readonly name: string
  readonly isSaving?: boolean
  readonly error?: string | undefined
  readonly successMessage?: string | undefined
  readonly onNameChange: (name: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

export const MealSetSaveForm = ({
  id,
  mealLabel,
  name,
  isSaving = false,
  error,
  successMessage,
  onNameChange,
  onSave,
  onCancel,
}: MealSetSaveFormProps): React.JSX.Element => {
  const titleId = `${id}-title`
  const nameId = `${id}-name`

  return (
    <section id={id} className={styles.formSection} aria-labelledby={titleId}>
      <h3 id={titleId} className={styles.title}>
        {mealLabel}をマイセットとして保存
      </h3>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault()
          onSave()
        }}
      >
        <label className={styles.label} htmlFor={nameId}>
          セット名
        </label>
        <input
          id={nameId}
          className={styles.nameInput}
          required
          value={name}
          disabled={isSaving}
          placeholder="セット名を入力"
          onChange={(event) => {
            onNameChange(event.currentTarget.value)
          }}
        />
        {error !== undefined && (
          <p className={styles.error} role="alert">
            保存できませんでした: {error}
          </p>
        )}
        {successMessage !== undefined && (
          <p className={styles.success} role="status">
            {successMessage}
          </p>
        )}
        <div className={styles.actions}>
          <button
            type="button"
            className={styles.secondaryButton}
            disabled={isSaving}
            onClick={onCancel}
          >
            キャンセル
          </button>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSaving || successMessage !== undefined}
          >
            {isSaving
              ? '保存中...'
              : successMessage !== undefined
                ? '保存しました'
                : '保存する'}
          </button>
        </div>
      </form>
    </section>
  )
}
