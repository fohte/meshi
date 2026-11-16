import styles from '#components/BodyCompositionForm/BodyCompositionForm.module.css'

export interface BodyCompositionDraft {
  readonly date: string
  readonly measuredTime: string
  readonly device: string
  readonly bodyFatPercent: string
  readonly muscleMassKg: string
  readonly skeletalMusclePercent: string
}

export interface BodyCompositionFormProps {
  readonly draft: BodyCompositionDraft
  readonly editingId: string | null
  readonly onDraftChange: (draft: BodyCompositionDraft) => void
  readonly onSave: () => void
  readonly onCancelEdit: () => void
  readonly saveError?: string | undefined
  readonly isSaving: boolean
}

export const BodyCompositionForm = ({
  draft,
  editingId,
  onDraftChange,
  onSave,
  onCancelEdit,
  saveError,
  isSaving,
}: BodyCompositionFormProps): React.JSX.Element => {
  const hasValue =
    draft.bodyFatPercent !== '' ||
    draft.muscleMassKg !== '' ||
    draft.skeletalMusclePercent !== ''

  return (
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        if (hasValue) onSave()
      }}
    >
      <div className={styles.formHeading}>
        <span className={styles.formMark}>##</span>
        <h2>{editingId === null ? '体組成を記録' : '体組成を訂正'}</h2>
      </div>
      <p className={styles.note}>
        体組成計による推定値です。機器が違う値は比べられません。
      </p>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>日付</span>
          <input
            type="date"
            value={draft.date}
            required
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({ ...draft, date: event.currentTarget.value })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>測定時刻 (任意)</span>
          <input
            type="time"
            value={draft.measuredTime}
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                measuredTime: event.currentTarget.value,
              })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>機器名</span>
          <input
            type="text"
            value={draft.device}
            maxLength={100}
            required
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({ ...draft, device: event.currentTarget.value })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>体脂肪率 (%)</span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="75"
            step="0.01"
            value={draft.bodyFatPercent}
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                bodyFatPercent: event.currentTarget.value,
              })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>筋肉量 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            min="5"
            max="200"
            step="0.01"
            value={draft.muscleMassKg}
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                muscleMassKg: event.currentTarget.value,
              })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>骨格筋率 (%)</span>
          <input
            type="number"
            inputMode="decimal"
            min="1"
            max="75"
            step="0.01"
            value={draft.skeletalMusclePercent}
            disabled={isSaving}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                skeletalMusclePercent: event.currentTarget.value,
              })
            }}
          />
        </label>
        <div className={styles.actions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSaving || !hasValue}
          >
            {isSaving
              ? '保存中...'
              : editingId === null
                ? '記録する'
                : '保存する'}
          </button>
          {editingId !== null && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onCancelEdit}
              disabled={isSaving}
            >
              キャンセル
            </button>
          )}
        </div>
      </div>
      {!hasValue && (
        <p className={styles.help}>項目を 1 つ以上入力してください。</p>
      )}
      {saveError !== undefined && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}
    </form>
  )
}
