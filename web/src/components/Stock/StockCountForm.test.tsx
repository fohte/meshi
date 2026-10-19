import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StockCountFormProps } from '#components/Stock/StockCountForm'
import { StockCountForm } from '#components/Stock/StockCountForm'

const STOCK_ITEMS: StockCountFormProps['stockItems'] = [
  {
    foodMasterId: 'food_example_herbs',
    foodName: '架空ハーブ',
    totalQuantity: 1.25,
  },
  {
    foodMasterId: 'food_example_crackers',
    foodName: '架空クラッカー',
    totalQuantity: 0,
  },
]

const performAct = (callback: () => void): Promise<void> =>
  act(async () => {
    callback()
    await Promise.resolve()
  })

const setupForm = async (
  overrides: Partial<StockCountFormProps> = {},
): Promise<{
  readonly container: HTMLDivElement
  readonly root: Root
  readonly submitted: Array<Parameters<StockCountFormProps['onSubmit']>[0]>
}> => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  const submitted: Array<Parameters<StockCountFormProps['onSubmit']>[0]> = []

  await performAct(() => {
    root.render(
      <StockCountForm
        stockItems={STOCK_ITEMS}
        foodMasterId="food_example_herbs"
        quantity=""
        receivedDate=""
        bestBefore=""
        isSaving={false}
        onFoodMasterIdChange={() => undefined}
        onQuantityChange={() => undefined}
        onReceivedDateChange={() => undefined}
        onBestBeforeChange={() => undefined}
        onSubmit={(input) => submitted.push(input)}
        {...overrides}
      />,
    )
  })

  return { container, root, submitted }
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

const savingState = (container: HTMLElement) => {
  const form = container.querySelector('form')
  const controls = Array.from(
    form?.querySelectorAll<
      HTMLInputElement | HTMLSelectElement | HTMLButtonElement
    >('input, select, button') ?? [],
  )

  return {
    referenceQuantity: container.querySelector('output')?.textContent,
    submitLabel: form?.querySelector('button')?.textContent,
    controlsDisabled: controls.map((control) => control.matches(':disabled')),
  }
}

const saveErrorState = (container: HTMLElement) => ({
  error: container.querySelector('[role="alert"]')?.textContent,
  submitDisabled:
    container.querySelector<HTMLButtonElement>('button')?.disabled,
})

const foodSelectionOutput = (
  container: HTMLElement,
  selectedFoodMasterIds: ReadonlyArray<string>,
) => ({
  options: Array.from(
    container.querySelectorAll<HTMLOptionElement>('select option'),
  ).map((option) => ({ value: option.value, label: option.label })),
  selectedFoodMasterIds,
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('StockCountForm', () => {
  it('lets users choose a stock item from the current stock list', async () => {
    const selectedFoodMasterIds: Array<string> = []
    const { container, root } = await setupForm({
      onFoodMasterIdChange: (id) => selectedFoodMasterIds.push(id),
    })
    try {
      await performAct(() => {
        const select = container.querySelector<HTMLSelectElement>('select')
        if (select === null) throw new Error('missing stock item select')
        const setter = Object.getOwnPropertyDescriptor(
          HTMLSelectElement.prototype,
          'value',
        )?.set?.bind(select)
        setter?.('food_example_crackers')
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })

      expect(foodSelectionOutput(container, selectedFoodMasterIds)).toEqual({
        options: [
          { value: 'food_example_herbs', label: '架空ハーブ' },
          { value: 'food_example_crackers', label: '架空クラッカー' },
        ],
        selectedFoodMasterIds: ['food_example_crackers'],
      })
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('submits a fractional absolute count and the optional dates', async () => {
    const { container, root, submitted } = await setupForm({
      quantity: '0.75',
      receivedDate: '2026-08-12',
      bestBefore: '2026-09-20',
    })
    try {
      await performAct(() => {
        container
          .querySelector<HTMLFormElement>('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          )
      })

      expect(submitted).toEqual([
        {
          foodMasterId: 'food_example_herbs',
          quantity: 0.75,
          receivedDate: '2026-08-12',
          bestBefore: '2026-09-20',
        },
      ])
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('keeps zero available and disables every control while saving', async () => {
    const { container, root } = await setupForm({
      foodMasterId: 'food_example_crackers',
      quantity: '0',
      isSaving: true,
    })
    try {
      expect(savingState(container)).toEqual({
        referenceQuantity: '0',
        submitLabel: '記録中…',
        controlsDisabled: [true, true, true, true, true],
      })
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('shows the save error without disabling retry', async () => {
    const { container, root } = await setupForm({
      quantity: '0.25',
      error: '在庫の記録に失敗しました。',
    })
    try {
      expect(saveErrorState(container)).toEqual({
        error: '在庫の記録に失敗しました。',
        submitDisabled: false,
      })
    } finally {
      await cleanupForm(container, root)
    }
  })

  it('does not submit an empty quantity as zero', async () => {
    const { container, root, submitted } = await setupForm()
    try {
      await performAct(() => {
        container
          .querySelector<HTMLFormElement>('form')
          ?.dispatchEvent(
            new Event('submit', { bubbles: true, cancelable: true }),
          )
      })

      expect(submitted).toEqual([])
    } finally {
      await cleanupForm(container, root)
    }
  })
})
