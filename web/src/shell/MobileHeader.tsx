import { useLocation } from 'react-router'

import styles from '#shell/MobileHeader.module.css'
import { NAV_ITEMS } from '#shell/nav-items'

const findCrumb = (pathname: string): string => {
  const match = NAV_ITEMS.find((item) =>
    item.path === '/' ? pathname === '/' : pathname.startsWith(item.path),
  )
  return match?.label ?? ''
}

export const MobileHeader = (): React.JSX.Element => {
  const location = useLocation()

  return (
    <div className={styles.header}>
      <span className={styles.logoMark}>&gt;</span>
      <span className={styles.logoText}>meshi</span>
      <span className={styles.crumb}>{findCrumb(location.pathname)}</span>
    </div>
  )
}
