import { Outlet } from 'react-router'

import styles from '#shell/AppShell.module.css'
import { MobileHeader } from '#shell/MobileHeader'
import { Sidebar } from '#shell/Sidebar'
import { TabBar } from '#shell/TabBar'

export const AppShell = (): React.JSX.Element => (
  <>
    <Sidebar />
    <main className={styles.main}>
      <MobileHeader />
      <div className={styles.content}>
        <Outlet />
      </div>
    </main>
    <TabBar />
  </>
)
