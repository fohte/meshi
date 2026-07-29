import styles from '#meal-log-sheet/DeleteConfirmDialog.module.css'

export interface DeleteConfirmDialogProps {
  readonly foodName: string
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly isDeleting: boolean
  readonly error: boolean
}

export const DeleteConfirmDialog = ({
  foodName,
  onCancel,
  onConfirm,
  isDeleting,
  error,
}: DeleteConfirmDialogProps): React.JSX.Element => (
  <div className={styles.overlay}>
    <div className={styles.dialog}>
      <div className={styles.message}>この記録を削除しますか?</div>
      <div className={styles.target}>{foodName}</div>
      {error && (
        <div className={styles.errorMessage}>
          削除に失敗しました。しばらくしてから再度お試しください。
        </div>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={styles.cancelButton}
          onClick={onCancel}
        >
          キャンセル
        </button>
        <button
          type="button"
          className={styles.confirmButton}
          disabled={isDeleting}
          onClick={onConfirm}
        >
          削除する
        </button>
      </div>
    </div>
  </div>
)
