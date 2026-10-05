import { Route, Routes } from 'react-router'

import { MealLogSheetProvider } from '#meal-log-sheet/MealLogSheetProvider'
import { DayPage } from '#pages/DayPage'
import { FoodDetailPage } from '#pages/FoodDetailPage'
import { FoodsPage } from '#pages/FoodsPage'
import { HistoryPage } from '#pages/HistoryPage'
import { SettingsPage } from '#pages/SettingsPage'
import { TodayPage } from '#pages/TodayPage'
import { AppShell } from '#shell/AppShell'

export const App = (): React.JSX.Element => (
  <MealLogSheetProvider>
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<TodayPage />} />
        <Route path="days/:date" element={<DayPage />} />
        <Route path="history" element={<HistoryPage />} />
        <Route path="foods" element={<FoodsPage />} />
        <Route path="foods/:id" element={<FoodDetailPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
    </Routes>
  </MealLogSheetProvider>
)
