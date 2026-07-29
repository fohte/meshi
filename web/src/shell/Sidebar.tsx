import { NavLink } from 'react-router'

import { useMealLogSheet } from '#meal-log-sheet/MealLogSheetContext'
import { NAV_ITEMS } from '#shell/nav-items'
import { navLinkClassName } from '#shell/nav-link-class-name'
import styles from '#shell/Sidebar.module.css'

export const Sidebar = (): React.JSX.Element => {
  const { openCreate } = useMealLogSheet()

  return (
    <nav className={styles.sidebar}>
      <div className={styles.logo}>
        <span className={styles.logoMark}>&gt;</span>
        <span className={styles.logoText}>meshi</span>
      </div>

      <div className={styles.nav}>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={navLinkClassName(styles.navItem, styles.navItemActive)}
          >
            <span className={styles.navItemHash}>#</span>
            {item.label}
          </NavLink>
        ))}
      </div>

      <button
        type="button"
        className={styles.createButton}
        onClick={openCreate}
      >
        + 記録する
      </button>

      <div className={styles.footnote}>
        <div>登録は Slack がメイン</div>
        <div>web は閲覧と振り返り</div>
      </div>
    </nav>
  )
}
