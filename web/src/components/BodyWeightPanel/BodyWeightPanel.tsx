import type { BodyComposition } from '#api/body-compositions'
import type { BodyWeight } from '#api/body-weights'
import type { WeightOutlook } from '#api/weight-outlook'
import {
  type BodyCompositionDraft,
  BodyCompositionForm,
} from '#components/BodyCompositionForm/BodyCompositionForm'
import { BodyWeightOutlookChart } from '#components/BodyWeightOutlookChart/BodyWeightOutlookChart'
import styles from '#components/BodyWeightPanel/BodyWeightPanel.module.css'
import { ErrorRetry } from '#components/ErrorRetry/ErrorRetry'
import { RecordDeleteDialog } from '#components/RecordDeleteDialog/RecordDeleteDialog'
import { Skeleton } from '#components/Skeleton/Skeleton'

export type BodyWeightPeriod = 'week' | 'month'

export interface BodyWeightDraft {
  readonly date: string
  readonly weightKg: string
  readonly measuredTime: string
}

export interface BodyWeightPanelProps {
  readonly outlookState: 'loading' | 'error' | 'loaded'
  readonly outlook?: WeightOutlook | undefined
  readonly onRetryOutlook: () => void
  readonly records: ReadonlyArray<BodyWeight>
  readonly compositionRecords: ReadonlyArray<BodyComposition>
  readonly loadState: 'loading' | 'error' | 'loaded'
  readonly loadError?: string | undefined
  readonly onRetry: () => void
  readonly compositionLoadState: 'loading' | 'error' | 'loaded'
  readonly compositionLoadError?: string | undefined
  readonly onRetryComposition: () => void
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
  readonly compositionDraft: BodyCompositionDraft
  readonly compositionEditingId: string | null
  readonly onCompositionDraftChange: (draft: BodyCompositionDraft) => void
  readonly onCompositionSave: () => void
  readonly onCancelCompositionEdit: () => void
  readonly compositionSaveError?: string | undefined
  readonly isSavingComposition: boolean
  readonly compositionDeleteTarget: BodyComposition | null
  readonly onRequestCompositionDelete: (record: BodyComposition) => void
  readonly onCancelCompositionDelete: () => void
  readonly onConfirmCompositionDelete: () => void
  readonly compositionDeleteError?: string | undefined
  readonly isDeletingComposition: boolean
  readonly onEditComposition: (record: BodyComposition) => void
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

const formatValue = (value: number | null, unit: string): string =>
  value === null
    ? '—'
    : `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(value)} ${unit}`

export const BodyWeightPanel = ({
  outlookState,
  outlook,
  onRetryOutlook,
  records,
  compositionRecords,
  loadState,
  loadError,
  onRetry,
  compositionLoadState,
  compositionLoadError,
  onRetryComposition,
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
  compositionDraft,
  compositionEditingId,
  onCompositionDraftChange,
  onCompositionSave,
  onCancelCompositionEdit,
  compositionSaveError,
  isSavingComposition,
  compositionDeleteTarget,
  onRequestCompositionDelete,
  onCancelCompositionDelete,
  onConfirmCompositionDelete,
  compositionDeleteError,
  isDeletingComposition,
  onEditComposition,
}: BodyWeightPanelProps): React.JSX.Element => {
  const groupedRecords = new Map<
    string,
    { weights: BodyWeight[]; compositions: BodyComposition[] }
  >()
  for (const record of records) {
    const group = groupedRecords.get(record.date) ?? {
      weights: [],
      compositions: [],
    }
    group.weights.push(record)
    groupedRecords.set(record.date, group)
  }
  for (const record of compositionRecords) {
    const group = groupedRecords.get(record.date) ?? {
      weights: [],
      compositions: [],
    }
    group.compositions.push(record)
    groupedRecords.set(record.date, group)
  }
  const dates = [...groupedRecords.keys()].sort((left, right) =>
    right.localeCompare(left),
  )

  return (
    <div className={styles.panel}>
      <BodyWeightOutlookChart
        state={outlookState}
        outlook={outlook}
        onRetry={onRetryOutlook}
      />
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
              disabled={isSaving}
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
              disabled={isSaving}
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
              disabled={isSaving}
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

      <BodyCompositionForm
        draft={compositionDraft}
        editingId={compositionEditingId}
        onDraftChange={onCompositionDraftChange}
        onSave={onCompositionSave}
        onCancelEdit={onCancelCompositionEdit}
        saveError={compositionSaveError}
        isSaving={isSavingComposition}
      />

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

        {compositionRecords.length > 0 && (
          <p className={styles.compositionEstimateNote}>
            体組成計による推定値です。機器が違う値は比べられません。
          </p>
        )}

        {loadState === 'error' && (
          <ErrorRetry
            message={loadError ?? '体重記録を読み込めませんでした'}
            onRetry={onRetry}
          />
        )}
        {compositionLoadState === 'error' && (
          <ErrorRetry
            message={compositionLoadError ?? '体組成記録を読み込めませんでした'}
            onRetry={onRetryComposition}
          />
        )}
        {(loadState === 'loading' || compositionLoadState === 'loading') &&
          dates.length === 0 && <Skeleton height={180} />}
        {loadState === 'loaded' &&
          compositionLoadState === 'loaded' &&
          dates.length === 0 && (
            <p className={styles.empty}>この期間の記録はありません</p>
          )}
        {dates.length > 0 && (
          <div className={styles.records}>
            {dates.map((date) => {
              const group = groupedRecords.get(date)
              if (group === undefined) return null
              return (
                <section className={styles.dayGroup} data-day={date} key={date}>
                  <h3>{formatDate(date)}</h3>
                  {group.weights.map((record) => (
                    <article
                      key={record.id}
                      className={styles.record}
                      data-record-id={record.id}
                    >
                      <div className={styles.recordText}>
                        <h4>体重</h4>
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
                  {group.compositions.map((record) => (
                    <article
                      key={record.id}
                      className={styles.compositionRecord}
                      data-composition-id={record.id}
                    >
                      <div className={styles.compositionText}>
                        <h4>{record.device}</h4>
                        {record.measuredAt !== null && (
                          <p>{formatTime(record.measuredAt)}</p>
                        )}
                        <div className={styles.compositionValues}>
                          <span>
                            体脂肪率 {formatValue(record.bodyFatPercent, '%')}
                          </span>
                          <span>
                            筋肉量 {formatValue(record.muscleMassKg, 'kg')}
                          </span>
                          <span>
                            骨格筋率{' '}
                            {formatValue(record.skeletalMusclePercent, '%')}
                          </span>
                        </div>
                      </div>
                      <div className={styles.recordActions}>
                        <button
                          type="button"
                          aria-label={`体組成を訂正 ${record.device} ${formatDate(record.date)}`}
                          disabled={
                            isSavingComposition || isDeletingComposition
                          }
                          onClick={() => {
                            onEditComposition(record)
                          }}
                        >
                          訂正
                        </button>
                        <button
                          type="button"
                          aria-label={`体組成を削除 ${record.device} ${formatDate(record.date)}`}
                          disabled={
                            isSavingComposition || isDeletingComposition
                          }
                          onClick={() => {
                            onRequestCompositionDelete(record)
                          }}
                        >
                          削除
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              )
            })}
          </div>
        )}
      </section>

      {deleteTarget !== null && (
        <RecordDeleteDialog
          title="記録を削除しますか?"
          message={`${formatDate(deleteTarget.date)} の ${formatWeight(deleteTarget.weightKg)} を削除します。`}
          confirmLabel="削除する"
          pendingLabel="削除中..."
          confirmAriaLabel="記録を削除"
          error={deleteError}
          isPending={isDeleting}
          onCancel={onCancelDelete}
          onConfirm={onConfirmDelete}
        />
      )}
      {compositionDeleteTarget !== null && (
        <RecordDeleteDialog
          title="体組成の記録を削除しますか?"
          message={`${formatDate(compositionDeleteTarget.date)} の ${compositionDeleteTarget.device} の記録を削除します。`}
          confirmLabel="削除する"
          pendingLabel="削除中..."
          confirmAriaLabel="体組成の記録を削除"
          error={compositionDeleteError}
          isPending={isDeletingComposition}
          onCancel={onCancelCompositionDelete}
          onConfirm={onConfirmCompositionDelete}
        />
      )}
    </div>
  )
}
