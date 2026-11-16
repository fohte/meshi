import styles from '#components/HistoryTabs/HistoryTabs.module.css'

export type HistoryViewName = 'calendar' | 'list' | 'report' | 'weight'

const HISTORY_VIEWS: ReadonlyArray<readonly [HistoryViewName, string]> = [
  ['calendar', 'カレンダー'],
  ['list', 'リスト'],
  ['report', 'レポート'],
  ['weight', '体重'],
]

export interface HistoryTabsProps {
  readonly activeView: HistoryViewName
  readonly onViewChange: (view: HistoryViewName) => void
}

export const HistoryTabs = ({
  activeView,
  onViewChange,
}: HistoryTabsProps): React.JSX.Element => (
  <div className={styles.tabs}>
    {HISTORY_VIEWS.map(([name, label]) => (
      <button
        key={name}
        type="button"
        className={styles.tab}
        data-active={activeView === name ? '' : undefined}
        onClick={() => {
          onViewChange(name)
        }}
      >
        {label}
      </button>
    ))}
  </div>
)
