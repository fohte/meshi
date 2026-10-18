import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import type { MealType } from '#api/day-detail'
import { MealTypeSelector } from '#components/MealTypeSelector/MealTypeSelector'

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

describe('MealTypeSelector', () => {
  it('reports the selected meal type and exposes the selected state', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root: Root = createRoot(container)
    const selected: Array<MealType> = []

    try {
      await performAct(() => {
        root.render(
          <MealTypeSelector
            value="breakfast"
            disabled={false}
            onChange={(mealType) => {
              selected.push(mealType)
            }}
          />,
        )
      })
      await performAct(() => {
        container
          .querySelectorAll<HTMLButtonElement>('button')[2]
          ?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })

      const output = () => ({
        selected,
        options: Array.from(
          container.querySelectorAll<HTMLButtonElement>('button'),
          (button) => ({
            label: button.textContent,
            pressed: button.getAttribute('aria-pressed'),
            disabled: button.disabled,
          }),
        ),
      })

      expect(output()).toEqual({
        selected: ['dinner'],
        options: [
          { label: '朝食', pressed: 'true', disabled: false },
          { label: '昼食', pressed: 'false', disabled: false },
          { label: '夕食', pressed: 'false', disabled: false },
          { label: '間食', pressed: 'false', disabled: false },
        ],
      })
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
      vi.unstubAllGlobals()
    }
  })
})
