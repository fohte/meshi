import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MealSet } from '#api/meal-sets'
import { MealSetPicker } from '#components/MealSetPicker/MealSetPicker'

const MEAL_SET: MealSet = {
  id: 'ms_demo_alpha',
  name: '作業用セット',
  items: [
    {
      foodMasterId: 'fm_demo_alpha',
      foodName: '架空食品 A',
      quantity: 1,
      energyKcalPerUnit: 120,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MealSetPicker', () => {
  it('returns the selected meal set', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    const selected: Array<MealSet> = []

    try {
      await performAct(() => {
        root.render(
          <MealSetPicker
            mealSets={[MEAL_SET]}
            isLoading={false}
            onSelect={(mealSet) => {
              selected.push(mealSet)
            }}
          />,
        )
      })
      await performAct(() => {
        container
          .querySelector<HTMLButtonElement>('button')
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      expect(selected).toEqual([MEAL_SET])
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })
})
