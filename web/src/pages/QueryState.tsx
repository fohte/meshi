import styles from '#pages/QueryState.module.css'

export interface QueryStateProps {
  isLoading: boolean
  error: Error | null
  onRetry: () => void
  children: React.ReactNode
}

// Every data-fetching page renders through this shared loading/error/content flow.
export const QueryState = ({
  isLoading,
  error,
  onRetry,
  children,
}: QueryStateProps): React.JSX.Element => {
  if (isLoading) {
    return <div className={styles.skeleton}>読み込み中…</div>
  }

  if (error !== null) {
    return (
      <div className={styles.error}>
        <p className={styles.errorMessage}>データの取得に失敗しました。</p>
        <button type="button" className={styles.retryButton} onClick={onRetry}>
          再試行
        </button>
      </div>
    )
  }

  return <>{children}</>
}
