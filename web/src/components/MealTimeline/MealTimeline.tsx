import type { MealTimelineGroup } from '#components/MealTimeline/build-meal-timeline-groups'
import styles from '#components/MealTimeline/MealTimeline.module.css'

export interface MealTimelineProps {
  readonly groups: ReadonlyArray<MealTimelineGroup>
  // Opens the meal log sheet in edit mode for the tapped entry. Optional so
  // Storybook stories can render the timeline without wiring up the sheet.
  readonly onItemClick?: (id: string) => void
}

export const MealTimeline = ({
  groups,
  onItemClick,
}: MealTimelineProps): React.JSX.Element => (
  <div className={styles.timeline}>
    {groups.map((group) => (
      <section key={group.mealType}>
        <div className={styles.groupHead}>
          <span className={styles.groupMark}>##</span>
          <span className={styles.groupLabel}>{group.label}</span>
          <span className={styles.groupKcal}>{group.kcalText}</span>
        </div>
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
      </section>
    ))}
  </div>
)
