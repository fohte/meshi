import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  type MealSetDraftItem,
  MealSetEditor,
  type MealSetFoodOption,
} from '#components/MealSetEditor/MealSetEditor'

const food: MealSetFoodOption = {
  foodMasterId: 'food_demo_alpha',
  name: '架空食品 A',
  energyKcalPerUnit: 120,
  isEstimated: false,
}

const item: MealSetDraftItem = {
  foodMasterId: food.foodMasterId,
  foodName: food.name,
  quantity: '1',
  energyKcalPerUnit: food.energyKcalPerUnit,
}

type EditorEvent =
  | { readonly action: 'add'; readonly foodMasterId: string }
  | {
      readonly action: 'quantity'
      readonly foodMasterId: string
      readonly quantity: string
    }
  | { readonly action: 'remove'; readonly foodMasterId: string }
  | { readonly action: 'save' }

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

const renderEditor = (
  root: Root,
  events: Array<EditorEvent>,
  items: ReadonlyArray<MealSetDraftItem>,
): void => {
  root.render(
    <MealSetEditor
      mode="create"
      name="作業用セット"
      items={items}
      foodQuery=""
      recentFoods={[food]}
      frequentFoods={[]}
      searchResults={[]}
      isSearching={false}
      onNameChange={() => undefined}
      onFoodQueryChange={() => undefined}
      onAddFood={(selectedFood) => {
        events.push({
          action: 'add',
          foodMasterId: selectedFood.foodMasterId,
        })
      }}
      onQuantityChange={(foodMasterId, quantity) => {
        events.push({ action: 'quantity', foodMasterId, quantity })
      }}
      onRemoveFood={(foodMasterId) => {
        events.push({ action: 'remove', foodMasterId })
      }}
      onSave={() => {
        events.push({ action: 'save' })
      }}
      onCancel={() => undefined}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('MealSetEditor', () => {
  it('adds a food, changes its quantity, removes it, and submits', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const events: Array<EditorEvent> = []

    try {
      await performAct(() => {
        renderEditor(root, events, [])
      })

      const foodButton = Array.from(
        container.querySelectorAll<HTMLButtonElement>('button'),
      ).find((button) => button.textContent.includes(food.name))
      await performAct(() => {
        foodButton?.click()
      })

      await performAct(() => {
        renderEditor(root, events, [item])
      })

      const quantityInput = container.querySelector<HTMLInputElement>(
        `input[aria-label="${food.name} の量"]`,
      )
      await performAct(() => {
        if (quantityInput !== null) {
          setNativeValue(quantityInput, '2.5')
          quantityInput.dispatchEvent(new Event('input', { bubbles: true }))
        }
      })

      const removeButton = container.querySelector<HTMLButtonElement>(
        `button[aria-label="${food.name} を削除"]`,
      )
      await performAct(() => {
        removeButton?.click()
      })

      await performAct(() => {
        renderEditor(root, events, [item])
      })
      await performAct(() => {
        const form = container.querySelector<HTMLFormElement>('form')
        if (form !== null) form.requestSubmit()
      })

      expect(events).toEqual([
        { action: 'add', foodMasterId: food.foodMasterId },
        {
          action: 'quantity',
          foodMasterId: food.foodMasterId,
          quantity: '2.5',
        },
        { action: 'remove', foodMasterId: food.foodMasterId },
        { action: 'save' },
      ])
    } finally {
      await performAct(() => {
        root.unmount()
      })
      container.remove()
    }
  })
})
