import { useLocation } from 'react-router'

import { useMealLogSheet } from '#meal-log-sheet/MealLogSheetContext'
import { BottomNavigationView } from '#shell/BottomNavigationView'
import { NAV_ITEMS } from '#shell/nav-items'
import styles from '#shell/TabBar.module.css'

export const TabBar = (): React.JSX.Element => {
  const { openCreate } = useMealLogSheet()
  const { pathname } = useLocation()

  return (
    <>
      <button
        type="button"
        className={styles.fab}
        aria-label="食事を記録"
        onClick={() => {
          openCreate()
        }}
      >
        +
      </button>
      <div className={styles.tabBar}>
        <BottomNavigationView
          aria-label="メインナビゲーション"
          items={NAV_ITEMS}
          pathname={pathname}
        />
      </div>
    </>
  )
}
