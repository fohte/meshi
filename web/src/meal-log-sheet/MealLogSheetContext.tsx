import { createContext, useContext } from 'react'

import type { DayDetailEntry } from '#api/day-detail'

export interface MealLogSheetContextValue {
  readonly openCreate: () => void
  readonly openEdit: (entry: DayDetailEntry) => void
}

const noop = (): void => {}

// Defaults to a no-op instead of throwing outside a provider: the app always
// mounts MealLogSheetProvider at the root, so this only matters for
// components rendered in isolation (e.g. Storybook stories).
export const MealLogSheetContext = createContext<MealLogSheetContextValue>({
  openCreate: noop,
  openEdit: noop,
})

export const useMealLogSheet = (): MealLogSheetContextValue =>
  useContext(MealLogSheetContext)
