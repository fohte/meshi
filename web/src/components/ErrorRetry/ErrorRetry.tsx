import styles from '#components/ErrorRetry/ErrorRetry.module.css'

export interface ErrorRetryProps {
  readonly message?: string
  readonly onRetry: () => void
}

export const ErrorRetry = ({
  message = '読み込みに失敗しました',
  onRetry,
}: ErrorRetryProps): React.JSX.Element => (
  <div className={styles.container}>
    <div className={styles.message}>{message}</div>
    <button type="button" className={styles.retryButton} onClick={onRetry}>
      再試行
    </button>
  </div>
)
