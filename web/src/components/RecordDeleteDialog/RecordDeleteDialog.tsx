import styles from '#components/RecordDeleteDialog/RecordDeleteDialog.module.css'

export interface RecordDeleteDialogProps {
  readonly title: string
  readonly message: string
  readonly confirmLabel: string
  readonly pendingLabel: string
  readonly confirmAriaLabel: string
  readonly error?: string | undefined
  readonly isPending: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}

export const RecordDeleteDialog = ({
  title,
  message,
  confirmLabel,
  pendingLabel,
  confirmAriaLabel,
  error,
  isPending,
  onCancel,
  onConfirm,
}: RecordDeleteDialogProps): React.JSX.Element => (
  <div className={styles.backdrop}>
    <div
      className={styles.dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="record-delete-title"
    >
      <h2 id="record-delete-title">{title}</h2>
      <p>{message}</p>
      {error !== undefined && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.secondaryButton}
          onClick={onCancel}
          disabled={isPending}
        >
          キャンセル
        </button>
        <button
          type="button"
          aria-label={confirmAriaLabel}
          className={styles.dangerButton}
          onClick={onConfirm}
          disabled={isPending}
        >
          {isPending ? pendingLabel : confirmLabel}
        </button>
      </div>
    </div>
  </div>
)
