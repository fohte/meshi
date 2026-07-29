import type { MealTimelineGroup } from '#components/MealTimeline/build-meal-timeline-groups'
import styles from '#components/MealTimeline/MealTimeline.module.css'

export interface MealTimelineProps {
  readonly groups: ReadonlyArray<MealTimelineGroup>
}

export const MealTimeline = ({
  groups,
}: MealTimelineProps): React.JSX.Element => (
  <div className={styles.timeline}>
    {groups.map((group) => (
      <section key={group.mealType} className={styles.group}>
        <div className={styles.groupHead}>
          <span className={styles.groupMark}>##</span>
          <span className={styles.groupLabel}>{group.label}</span>
          <span className={styles.groupKcal}>{group.kcalText}</span>
        </div>
        <div className={styles.items}>
          {group.items.map((item) => (
            <div key={item.id} className={styles.item}>
              <span className={styles.itemTime}>{item.time}</span>
              <div className={styles.itemMain}>
                <div className={styles.itemNameLine}>
                  <span className={styles.itemName}>{item.name}</span>
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
            </div>
          ))}
        </div>
      </section>
    ))}
  </div>
)
