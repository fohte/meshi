import type { MealType } from '#api/day-detail'
import type { MealTimelineGroup } from '#components/MealTimeline/build-meal-timeline-groups'
import styles from '#components/MealTimeline/MealTimeline.module.css'

export interface MealTimelineProps {
  readonly groups: ReadonlyArray<MealTimelineGroup>
  // Opens the meal log sheet in edit mode for the tapped entry. Optional so
  // Storybook stories can render the timeline without wiring up the sheet.
  readonly onItemClick?: (id: string) => void
  // Records/cancels a skip for an unrecorded/skipped meal type. Optional for
  // the same Storybook reason as onItemClick.
  readonly onMarkSkipped?: (mealType: MealType) => void
  readonly onCancelSkip?: (mealType: MealType) => void
  readonly isSkipActionPending?: boolean
}

export const MealTimeline = ({
  groups,
  onItemClick,
  onMarkSkipped,
  onCancelSkip,
  isSkipActionPending,
}: MealTimelineProps): React.JSX.Element => (
  <div className={styles.timeline}>
    {groups.map((group) => (
      <section key={group.mealType}>
        <div className={styles.groupHead}>
          <span className={styles.groupMark}>##</span>
          <span className={styles.groupLabel}>{group.label}</span>
          {group.status === 'eaten' && (
            <span className={styles.groupKcal}>{group.kcalText}</span>
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
          {group.status === 'unrecorded' && (
            <div className={styles.groupStatus}>
              <span className={styles.groupStatusText}>未記録</span>
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
            </div>
          )}
        </div>
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
                <span className={styles.itemTime}>{item.time}</span>
                <div className={styles.itemMain}>
                  <div className={styles.itemNameLine}>
                    <span>{item.name}</span>
                    {item.isEstimated && (
                      <span className={styles.itemEstimateMark}> ~</span>
                    )}
                  </div>
                  <div className={styles.itemMeta}>
                    {item.quantityText}
                    {item.note !== null && item.note !== '' && (
                      <span> · {item.note}</span>
                    )}
                  </div>
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
