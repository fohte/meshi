import { Route, Routes } from 'react-router'

import { DayPage } from '#pages/DayPage'
import { FoodsPage } from '#pages/FoodsPage'
import { HistoryPage } from '#pages/HistoryPage'
import { SettingsPage } from '#pages/SettingsPage'
import { TodayPage } from '#pages/TodayPage'
import { AppShell } from '#shell/AppShell'

export const App = (): React.JSX.Element => (
  <Routes>
    <Route element={<AppShell />}>
      <Route index element={<TodayPage />} />
      <Route path="days/:date" element={<DayPage />} />
      <Route path="history" element={<HistoryPage />} />
      <Route path="foods" element={<FoodsPage />} />
      <Route path="settings" element={<SettingsPage />} />
    </Route>
  </Routes>
)
