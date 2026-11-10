import type { MealType } from '#api/day-detail'
import type { MealTimelineGroup } from '#components/MealTimeline/build-meal-timeline-groups'
import styles from '#components/MealTimeline/MealTimeline.module.css'

export interface MealTimelineProps {
  readonly groups: ReadonlyArray<MealTimelineGroup>
  readonly dateKind?: 'past' | 'today' | 'future'
  readonly renderMealPhotos?: (mealType: MealType) => React.ReactNode
  // Opens the meal log sheet in edit mode for the tapped entry. Optional so
  // Storybook stories can render the timeline without wiring up the sheet.
  readonly onItemClick?: (id: string) => void
  // Records/cancels a skip for an unrecorded/skipped meal type. Optional for
  // the same Storybook reason as onItemClick.
  readonly onMarkSkipped?: (mealType: MealType) => void
  readonly onCancelSkip?: (mealType: MealType) => void
  readonly isSkipActionPending?: boolean
  readonly saveMealSetFormMealType?: MealType | null
  readonly onToggleMealSetSave?: (mealType: MealType) => void
  readonly renderMealSetSaveForm?: (mealType: MealType) => React.ReactNode
  readonly isMealSetSavePending?: boolean
  readonly onCreatePlan?: (mealType: MealType) => void
  readonly onEditPlan?: (mealType: MealType) => void
  readonly onRecordPlan?: (mealType: MealType) => void
  readonly onCancelPlan?: (planId: string) => void
  readonly planActionError?: {
    readonly planId: string
    readonly message: string
  } | null
  readonly isPlanActionPending?: boolean
}

export const MealTimeline = ({
  groups,
  dateKind = 'past',
  renderMealPhotos,
  onItemClick,
  onMarkSkipped,
  onCancelSkip,
  isSkipActionPending,
  saveMealSetFormMealType = null,
  onToggleMealSetSave,
  renderMealSetSaveForm,
  isMealSetSavePending = false,
  onCreatePlan,
  onEditPlan,
  onRecordPlan,
  onCancelPlan,
  planActionError = null,
  isPlanActionPending = false,
}: MealTimelineProps): React.JSX.Element => (
  <div className={styles.timeline}>
    {groups.map((group) => (
      <section key={group.mealType}>
        <div className={styles.groupHead}>
          <span className={styles.groupMark}>##</span>
          <span className={styles.groupLabel}>{group.label}</span>
          {group.status === 'eaten' && (
            <div className={styles.groupActions}>
              <span className={styles.groupKcal}>{group.kcalText}</span>
              <button
                type="button"
                className={styles.groupSaveAction}
                aria-label={`${group.label}をマイセットとして保存`}
                aria-expanded={saveMealSetFormMealType === group.mealType}
                disabled={isMealSetSavePending}
                onClick={() => {
                  onToggleMealSetSave?.(group.mealType)
                }}
              >
                {saveMealSetFormMealType === group.mealType
                  ? '入力を閉じる'
                  : 'マイセットとして保存'}
              </button>
            </div>
          )}
          {group.status === 'skipped' && (
            <div className={styles.groupStatus}>
              <span className={styles.groupStatusText}>食べなかった</span>
              <button
                type="button"
                className={styles.groupStatusAction}
                disabled={isSkipActionPending}
                onClick={() => {
                  onCancelSkip?.(group.mealType)
                }}
              >
                取り消す
              </button>
            </div>
          )}
          {group.status === 'planned' && (
            <div className={styles.groupStatus}>
              <span className={styles.groupStatusText}>予定</span>
              {dateKind !== 'future' && (
                <button
                  type="button"
                  className={styles.groupStatusAction}
                  disabled={isPlanActionPending}
                  onClick={() => onRecordPlan?.(group.mealType)}
                >
                  食べた
                </button>
              )}
              {dateKind !== 'past' && (
                <button
                  type="button"
                  className={styles.groupStatusAction}
                  disabled={isPlanActionPending}
                  onClick={() => onEditPlan?.(group.mealType)}
                >
                  予定を変更
                </button>
              )}
              <button
                type="button"
                className={styles.groupStatusAction}
                disabled={isPlanActionPending}
                onClick={() => {
                  if (group.plan !== undefined) onCancelPlan?.(group.plan.id)
                }}
              >
                取り消す
              </button>
            </div>
          )}
          {group.status === 'unrecorded' && (
            <div className={styles.groupStatus}>
              <span className={styles.groupStatusText}>
                {dateKind === 'future' ? '予定なし' : '未記録'}
              </span>
              {dateKind !== 'future' && (
                <button
                  type="button"
                  className={styles.groupStatusAction}
                  disabled={isSkipActionPending}
                  onClick={() => {
                    onMarkSkipped?.(group.mealType)
                  }}
                >
                  食べなかった
                </button>
              )}
              {(dateKind === 'today' || dateKind === 'future') && (
                <button
                  type="button"
                  className={styles.groupStatusAction}
                  disabled={isPlanActionPending}
                  onClick={() => onCreatePlan?.(group.mealType)}
                >
                  予定を立てる
                </button>
              )}
            </div>
          )}
        </div>
        {group.status === 'planned' &&
          planActionError !== null &&
          group.plan?.id === planActionError.planId && (
            <div className={styles.planError} role="alert">
              {planActionError.message}
            </div>
          )}
        {dateKind !== 'future' &&
          group.status !== 'planned' &&
          renderMealPhotos?.(group.mealType)}
        {group.status === 'eaten' && renderMealSetSaveForm?.(group.mealType)}
        {group.status === 'planned' && (
          <>
            <div className={styles.items}>
              {group.items.map((item) => (
                <div key={item.id} className={styles.planItem}>
                  <div className={styles.itemMain}>
                    <div className={styles.itemNameLine}>{item.name}</div>
                    <div className={styles.itemMeta}>{item.quantityText}</div>
                  </div>
                  <span className={styles.itemKcal}>{item.kcalText}</span>
                </div>
              ))}
            </div>
            {group.plan?.reason !== null &&
              group.plan?.reason !== undefined && (
                <p className={styles.planReason} role="note">
                  メモ: {group.plan.reason}
                </p>
              )}
          </>
        )}
        {group.status === 'eaten' && (
          <div className={styles.items}>
            {group.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className={styles.item}
                onClick={() => {
                  onItemClick?.(item.id)
                }}
              >
                <div className={styles.itemMain}>
                  <div className={styles.itemNameLine}>
                    <span>{item.name}</span>
                    {item.isUnknown ? (
                      <span className={styles.itemEstimateMark}> 不明</span>
                    ) : item.isEstimated ? (
                      <span className={styles.itemEstimateMark}> ~</span>
                    ) : null}
                    {item.hasNutritionVersionDifferences && (
                      <span className={styles.itemVersionDiffMark}> ≠</span>
                    )}
                  </div>
                  <div className={styles.itemMeta}>{item.quantityText}</div>
                </div>
                <span className={styles.itemKcal}>{item.kcalText}</span>
              </button>
            ))}
          </div>
        )}
      </section>
    ))}
  </div>
)
