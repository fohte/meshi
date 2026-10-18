import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { MealSetRecordFormProps } from '#components/MealSetRecordForm/MealSetRecordForm'
import { MealSetRecordForm } from '#components/MealSetRecordForm/MealSetRecordForm'

const ITEM: MealSetRecordFormProps['items'][number] = {
  id: 3,
  foodName: '架空食品 A',
  quantity: '1',
  energyKcalPerUnit: 120,
}

type FormEvent =
  | {
      readonly action: 'quantity'
      readonly itemId: number
      readonly value: string
    }
  | { readonly action: 'remove'; readonly itemId: number }
  | { readonly action: 'replace'; readonly itemId: number }
  | { readonly action: 'add' }
  | { readonly action: 'meal-type'; readonly value: string }
  | { readonly action: 'date'; readonly value: string }

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const setNativeValue = (input: HTMLInputElement, value: string): void => {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set?.bind(input)
  if (setter !== undefined) setter(value)
}

const setupForm = async (): Promise<{
  readonly container: HTMLDivElement
  readonly root: Root
  readonly events: Array<FormEvent>
}> => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const events: Array<FormEvent> = []

  await performAct(() => {
    root.render(
      <MealSetRecordForm
        mealSetName="作業用セット"
        items={[ITEM]}
        date="2026-01-01"
        mealType="breakfast"
        isSaving={false}
        onQuantityChange={(itemId, value) => {
          events.push({ action: 'quantity', itemId, value })
        }}
        onRemoveItem={(itemId) => {
          events.push({ action: 'remove', itemId })
        }}
        onReplaceItem={(itemId) => {
          events.push({ action: 'replace', itemId })
        }}
        onAddItem={() => {
          events.push({ action: 'add' })
        }}
        onMealTypeChange={(value) => {
          events.push({ action: 'meal-type', value })
        }}
        onDateChange={(value) => {
          events.push({ action: 'date', value })
        }}
      />,
    )
  })

  return { container, root, events }
}

const cleanupForm = async (
  container: HTMLElement,
  root: Root,
): Promise<void> => {
  await performAct(() => {
    root.unmount()
  })
  container.remove()
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MealSetRecordForm', () => {
  it('changes an item quantity', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        const input = container.querySelector<HTMLInputElement>(
          `input[aria-label="${ITEM.foodName} の量"]`,
        )
        if (input !== null) {
          setNativeValue(input, '2.5')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })

      expect(events).toEqual([{ action: 'quantity', itemId: 3, value: '2.5' }])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('replaces an item', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        container
          .querySelector<HTMLButtonElement>(
            `button[aria-label="${ITEM.foodName} を差し替え"]`,
          )
          ?.click()
      })

      expect(events).toEqual([{ action: 'replace', itemId: 3 }])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('removes an item', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        container
          .querySelector<HTMLButtonElement>(
            `button[aria-label="${ITEM.foodName} を削除"]`,
          )
          ?.click()
      })

      expect(events).toEqual([{ action: 'remove', itemId: 3 }])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('starts adding an item', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        const addButton = Array.from(
          container.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent.includes('食品を追加'))
        addButton?.click()
      })

      expect(events).toEqual([{ action: 'add' }])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('changes the meal type', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        const lunchButton = Array.from(
          container.querySelectorAll<HTMLButtonElement>('button'),
        ).find((button) => button.textContent === '昼食')
        lunchButton?.click()
      })

      expect(events).toEqual([{ action: 'meal-type', value: 'lunch' }])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('changes the date', async () => {
    const { container, root, events } = await setupForm()
    try {
      await performAct(() => {
        const input =
          container.querySelector<HTMLInputElement>('input[type="date"]')
        if (input !== null) {
          setNativeValue(input, '2026-01-02')
          input.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })

      expect(events).toEqual([{ action: 'date', value: '2026-01-02' }])
    } finally {
      await cleanupForm(container, root)
    }
  })
})
