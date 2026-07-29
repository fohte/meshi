import { NavLink } from 'react-router'

import { useMealLogSheet } from '#meal-log-sheet/MealLogSheetContext'
import { NAV_ITEMS } from '#shell/nav-items'
import { navLinkClassName } from '#shell/nav-link-class-name'
import styles from '#shell/TabBar.module.css'

export const TabBar = (): React.JSX.Element => {
  const { openCreate } = useMealLogSheet()

  return (
    <>
      <button type="button" className={styles.fab} onClick={openCreate}>
        +
      </button>
      <nav className={styles.tabBar}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={navLinkClassName(styles.tabItem, styles.tabItemActive)}
          >
            <span className={styles.tabItemHash}>#</span>
            <span className={styles.tabItemLabel}>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  )
}
