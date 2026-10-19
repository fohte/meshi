import {
  BottomNavigation,
  type BottomNavigationItem,
} from '@fohte/ui/bottom-navigation'
import { matchPath, NavLink } from 'react-router'

import styles from '#shell/BottomNavigationView.module.css'
import type { NavItem } from '#shell/nav-items'

type BottomNavigationViewProps = {
  readonly 'aria-label': string
  readonly items: ReadonlyArray<NavItem>
  readonly pathname: string
}

export const BottomNavigationView = ({
  'aria-label': ariaLabel,
  items,
  pathname,
}: BottomNavigationViewProps): React.JSX.Element => {
  const navigationItems: ReadonlyArray<BottomNavigationItem> = items.map(
    (item) => ({
      id: item.path,
      type: 'link',
      label: item.label,
      icon: '#',
      selected:
        matchPath({ path: item.path, end: item.path === '/' }, pathname) !==
        null,
      renderLink: ({
        children,
        className,
        'aria-current': ariaCurrent,
        'data-slot': dataSlot,
      }) => (
        <NavLink
          to={item.path}
          end={item.path === '/'}
          className={className}
          aria-current={ariaCurrent}
          data-slot={dataSlot}
        >
          {children}
        </NavLink>
      ),
    }),
  )

  return (
    <BottomNavigation
      aria-label={ariaLabel}
      className={styles.navigation}
      items={navigationItems}
    />
  )
}
