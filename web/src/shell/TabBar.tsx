import { NavLink } from 'react-router'

import { NAV_ITEMS } from '#shell/nav-items'
import styles from '#shell/TabBar.module.css'

export const TabBar = (): React.JSX.Element => (
  <>
    <button type="button" className={styles.fab}>
      +
    </button>
    <nav className={styles.tabBar}>
      {NAV_ITEMS.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          className={({ isActive }) =>
            [styles.tabItem, isActive ? styles.tabItemActive : '']
              .filter(Boolean)
              .join(' ')
          }
        >
          <span className={styles.tabItemHash}>#</span>
          <span className={styles.tabItemLabel}>{item.label}</span>
        </NavLink>
      ))}
    </nav>
  </>
)
