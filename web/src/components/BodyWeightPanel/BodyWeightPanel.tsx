import type { BodyWeight } from '#api/body-weights'
import styles from '#components/BodyWeightPanel/BodyWeightPanel.module.css'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { Skeleton } from '#components/Skeleton/Skeleton'

export type BodyWeightPeriod = 'week' | 'month'

export interface BodyWeightDraft {
  readonly date: string
  readonly weightKg: string
  readonly measuredTime: string
}

export interface BodyWeightPanelProps {
  readonly records: ReadonlyArray<BodyWeight>
  readonly loadState: 'loading' | 'error' | 'loaded'
  readonly loadError?: string | undefined
  readonly onRetry: () => void
  readonly period: BodyWeightPeriod
  readonly rangeLabel: string
  readonly canGoForward: boolean
  readonly onPeriodChange: (period: BodyWeightPeriod) => void
  readonly onPreviousPeriod: () => void
  readonly onNextPeriod: () => void
  readonly draft: BodyWeightDraft
  readonly editingId: string | null
  readonly onDraftChange: (draft: BodyWeightDraft) => void
  readonly onSave: () => void
  readonly onCancelEdit: () => void
  readonly saveError?: string | undefined
  readonly isSaving: boolean
  readonly deleteTarget: BodyWeight | null
  readonly onRequestDelete: (record: BodyWeight) => void
  readonly onCancelDelete: () => void
  readonly onConfirmDelete: () => void
  readonly deleteError?: string | undefined
  readonly isDeleting: boolean
  readonly onEdit: (record: BodyWeight) => void
}

const formatDate = (date: string): string => {
  const year = date.slice(0, 4)
  const month = String(Number(date.slice(5, 7)))
  const day = String(Number(date.slice(8, 10)))
  return `${year}年${month}月${day}日`
}

const formatTime = (measuredAt: string): string =>
  new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(measuredAt))

const formatWeight = (weightKg: number): string =>
  `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(weightKg)} kg`

export const BodyWeightPanel = ({
  records,
  loadState,
  loadError,
  onRetry,
  period,
  rangeLabel,
  canGoForward,
  onPeriodChange,
  onPreviousPeriod,
  onNextPeriod,
  draft,
  editingId,
  onDraftChange,
  onSave,
  onCancelEdit,
  saveError,
  isSaving,
  deleteTarget,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
  deleteError,
  isDeleting,
  onEdit,
}: BodyWeightPanelProps): React.JSX.Element => (
  <div className={styles.panel}>
    <form
      className={styles.form}
      onSubmit={(event) => {
        event.preventDefault()
        onSave()
      }}
    >
      <div className={styles.formHeading}>
        <span className={styles.formMark}>##</span>
        <h2>{editingId === null ? '体重を記録' : '記録を訂正'}</h2>
      </div>
      <div className={styles.fields}>
        <label className={styles.field}>
          <span>日付</span>
          <input
            type="date"
            value={draft.date}
            required
            onChange={(event) => {
              onDraftChange({ ...draft, date: event.currentTarget.value })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>体重 (kg)</span>
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={draft.weightKg}
            required
            onChange={(event) => {
              onDraftChange({ ...draft, weightKg: event.currentTarget.value })
            }}
          />
        </label>
        <label className={styles.field}>
          <span>測定時刻 (任意)</span>
          <input
            type="time"
            value={draft.measuredTime}
            onChange={(event) => {
              onDraftChange({
                ...draft,
                measuredTime: event.currentTarget.value,
              })
            }}
          />
        </label>
        <div className={styles.formActions}>
          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSaving}
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
            >
              キャンセル
            </button>
          )}
        </div>
      </div>
      {saveError !== undefined && (
        <p className={styles.error} role="alert">
          {saveError}
        </p>
      )}
    </form>

    <section
      className={styles.history}
      aria-labelledby="body-weight-history-title"
    >
      <div className={styles.historyHeading}>
        <div className={styles.formHeading}>
          <span className={styles.formMark}>##</span>
          <h2 id="body-weight-history-title">記録一覧</h2>
        </div>
        <div className={styles.periodTabs} aria-label="表示期間">
          <button
            type="button"
            data-active={period === 'week' ? '' : undefined}
            onClick={() => {
              onPeriodChange('week')
            }}
          >
            7 日
          </button>
          <button
            type="button"
            data-active={period === 'month' ? '' : undefined}
            onClick={() => {
              onPeriodChange('month')
            }}
          >
            30 日
          </button>
        </div>
      </div>
      <div className={styles.rangeNav}>
        <button
          type="button"
          aria-label="前の期間"
          className={styles.navButton}
          onClick={onPreviousPeriod}
        >
          ←
        </button>
        <span>{rangeLabel}</span>
        <button
          type="button"
          aria-label="次の期間"
          className={styles.navButton}
          disabled={!canGoForward}
          onClick={onNextPeriod}
        >
          →
        </button>
      </div>

      {loadState === 'error' && (
        <ErrorRetry
          message={loadError ?? '体重記録を読み込めませんでした'}
          onRetry={onRetry}
        />
      )}
      {loadState === 'loading' && <Skeleton height={180} />}
      {loadState === 'loaded' &&
        (records.length === 0 ? (
          <p className={styles.empty}>この期間の記録はありません</p>
        ) : (
          <div className={styles.records}>
            {records.map((record) => (
              <article
                key={record.id}
                className={styles.record}
                data-record-id={record.id}
              >
                <div className={styles.recordText}>
                  <h3>{formatDate(record.date)}</h3>
                  {record.measuredAt !== null && (
                    <p>{formatTime(record.measuredAt)}</p>
                  )}
                </div>
                <strong>{formatWeight(record.weightKg)}</strong>
                <div className={styles.recordActions}>
                  <button
                    type="button"
                    aria-label={`訂正 ${formatDate(record.date)}`}
                    onClick={() => {
                      onEdit(record)
                    }}
                  >
                    訂正
                  </button>
                  <button
                    type="button"
                    aria-label={`削除 ${formatDate(record.date)}`}
                    onClick={() => {
                      onRequestDelete(record)
                    }}
                  >
                    削除
                  </button>
                </div>
              </article>
            ))}
          </div>
        ))}
    </section>

    {deleteTarget !== null && (
      <div className={styles.dialogBackdrop}>
        <div
          className={styles.dialog}
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="body-weight-delete-title"
        >
          <h2 id="body-weight-delete-title">記録を削除しますか?</h2>
          <p>
            {formatDate(deleteTarget.date)} の{' '}
            {formatWeight(deleteTarget.weightKg)}
            を削除します。
          </p>
          {deleteError !== undefined && (
            <p className={styles.error} role="alert">
              {deleteError}
            </p>
          )}
          <div className={styles.dialogActions}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={onCancelDelete}
              disabled={isDeleting}
            >
              キャンセル
            </button>
            <button
              type="button"
              aria-label="記録を削除"
              className={styles.dangerButton}
              onClick={onConfirmDelete}
              disabled={isDeleting}
            >
              {isDeleting ? '削除中...' : '削除する'}
            </button>
          </div>
        </div>
      </div>
    )}
  </div>
)
