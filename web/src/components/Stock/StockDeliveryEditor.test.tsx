import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { StockStatus } from '#api/stock'
import type {
  ReceiveStockDeliveryInput,
  RegisterStockDeliveryInput,
} from '#api/stock-deliveries'
import type { StockDeliveryEditorProps } from '#components/Stock/stock-delivery-editor-types'
import { StockDeliveryEditor } from '#components/Stock/StockDeliveryEditor'
import { performAct, setInputValue } from '#test/test-helpers'

const STOCK_ITEMS: StockStatus['stockItems'] = [
  {
    foodMasterId: 'food_example_oats',
    foodName: '架空オーツ',
    storageLocation: null,
    eatWithinDays: null,
    totalQuantity: 0,
    lots: [],
    storageLocationId: null,
  },
]

const DELIVERY: StockStatus['plannedDeliveries'][number] = {
  id: 'delivery_example',
  sourceRef: 'order_example_42',
  expectedDate: '2026-11-14',
  changeDeadline: '2026-11-10',
  items: [
    {
      foodMasterId: 'food_example_oats',
      foodName: '架空オーツ',
      quantity: 2,
    },
  ],
}

const mountedRoots: Root[] = []

interface EditorSetup {
  readonly container: HTMLDivElement
  readonly registerCalls: Array<RegisterStockDeliveryInput>
  readonly receiveCalls: Array<{
    readonly deliveryId: string
    readonly input: ReceiveStockDeliveryInput
  }>
}

const setupEditor = (
  props: Partial<StockDeliveryEditorProps> = {},
): EditorSetup => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  const registerCalls: Array<RegisterStockDeliveryInput> = []
  const receiveCalls: Array<{
    readonly deliveryId: string
    readonly input: ReceiveStockDeliveryInput
  }> = []
  const defaultProps: StockDeliveryEditorProps = {
    mode: 'create',
    delivery: null,
    isSubmitting: false,
    onClose: () => undefined,
    onRegister: (input) => registerCalls.push(input),
    onReceive: (deliveryId, input) => receiveCalls.push({ deliveryId, input }),
  }
  act(() => {
    root.render(
      <StockDeliveryEditor
        stockItems={STOCK_ITEMS}
        {...defaultProps}
        {...props}
      />,
    )
  })
  return { container, registerCalls, receiveCalls }
}

const setSelectValue = async (
  select: HTMLSelectElement,
  value: string,
): Promise<void> =>
  performAct(() => {
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      'value',
    )?.set?.bind(select)
    setValue?.(value)
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })

const clickButton = async (
  container: HTMLElement,
  label: string,
): Promise<void> =>
  performAct(() => {
    Array.from(container.querySelectorAll('button'))
      .find((button) => button.textContent.trim() === label)
      ?.click()
  })

const submitForm = async (container: HTMLElement): Promise<void> =>
  performAct(() => {
    container
      .querySelector('form')
      ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })

const readEditOutput = (
  setup: EditorSetup,
  sourceRef: HTMLInputElement | null,
) => ({
  registerCalls: setup.registerCalls,
  sourceRefReadOnly: sourceRef?.readOnly,
})

const readCancellationOutput = (
  setup: EditorSetup,
  review: {
    readonly text: string
    readonly registerCalls: RegisterStockDeliveryInput[]
  },
) => ({ review, registerCalls: setup.registerCalls })

const readReceiptOutput = (
  setup: EditorSetup,
  review: {
    readonly text: string
    readonly receiveCalls: EditorSetup['receiveCalls']
  },
) => ({
  review,
  receiveCalls: setup.receiveCalls.map((call) => ({
    deliveryId: call.deliveryId,
    input: { ...call.input, receivedDate: '<date>' },
  })),
})

afterEach(async () => {
  await performAct(() => {
    for (const root of mountedRoots) root.unmount()
  })
  mountedRoots.length = 0
  document.body.innerHTML = ''
  vi.unstubAllGlobals()
})

describe('StockDeliveryEditor', () => {
  it('registers a planned delivery with a required order number', async () => {
    const setup = setupEditor()
    const sourceRef = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-source-ref',
    )
    const expectedDate = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-expected-date',
    )
    const itemSelect = setup.container.querySelector('select')
    if (sourceRef !== null) await setInputValue(sourceRef, 'order_example_57')
    if (expectedDate !== null) await setInputValue(expectedDate, '2026-12-02')
    if (itemSelect !== null)
      await setSelectValue(itemSelect, 'food_example_oats')
    const quantity = setup.container.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )
    if (quantity !== null) await setInputValue(quantity, '3.5')
    await submitForm(setup.container)

    expect(setup.registerCalls).toEqual([
      {
        sourceRef: 'order_example_57',
        status: 'planned',
        expectedDate: '2026-12-02',
        changeDeadline: null,
        items: [{ foodMasterId: 'food_example_oats', quantity: 3.5 }],
      },
    ])
  })

  it('keeps the order number fixed when editing a delivery', async () => {
    const setup = setupEditor({ mode: 'edit', delivery: DELIVERY })
    const sourceRef = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-source-ref',
    )
    const expectedDate = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-expected-date',
    )
    if (expectedDate !== null) await setInputValue(expectedDate, '2026-12-03')
    await submitForm(setup.container)

    expect(readEditOutput(setup, sourceRef)).toEqual({
      registerCalls: [
        {
          sourceRef: 'order_example_42',
          status: 'planned',
          expectedDate: '2026-12-03',
          changeDeadline: '2026-11-10',
          items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
        },
      ],
      sourceRefReadOnly: true,
    })
  })

  it('shows cancellation details before sending the cancellation', async () => {
    const setup = setupEditor({ mode: 'cancel', delivery: DELIVERY })
    const review = {
      text: setup.container.textContent.replace(/\s+/g, ' ').trim(),
      registerCalls: [...setup.registerCalls],
    }
    await clickButton(setup.container, 'この予定を取り消す')

    expect(readCancellationOutput(setup, review)).toEqual({
      review: {
        text: '##入荷予定を取り消すの確認×取消内容meshi の入荷予定を取り消します。注文先への注文キャンセルは行いません。注文番号order_example_42入荷予定日2026-11-14架空オーツ数量 2戻るこの予定を取り消す',
        registerCalls: [],
      },
      registerCalls: [
        {
          sourceRef: 'order_example_42',
          status: 'cancelled',
          expectedDate: '2026-11-14',
          changeDeadline: '2026-11-10',
          items: [{ foodMasterId: 'food_example_oats', quantity: 2 }],
        },
      ],
    })
  })

  it('confirms the actual received quantity, including zero', async () => {
    const setup = setupEditor({ mode: 'receive', delivery: DELIVERY })
    const quantity = setup.container.querySelector<HTMLInputElement>(
      'input[type="number"]',
    )
    const receivedDate = setup.container.querySelector<HTMLInputElement>(
      '#stock-delivery-received-date',
    )?.value
    if (quantity !== null) await setInputValue(quantity, '0')
    await submitForm(setup.container)
    const review = {
      text: setup.container.textContent
        .replace(/\s+/g, ' ')
        .trim()
        .replace(receivedDate ?? '', '<date>'),
      receiveCalls: [...setup.receiveCalls],
    }
    await clickButton(setup.container, '受領を確定')

    expect(readReceiptOutput(setup, review)).toEqual({
      review: {
        text: '##入荷を受領するの確認×受領内容表示した数量で配送全体の受領を確定します。注文番号order_example_42入荷予定日2026-11-14受領日<date>架空オーツ数量 0戻る受領を確定',
        receiveCalls: [],
      },
      receiveCalls: [
        {
          deliveryId: 'delivery_example',
          input: {
            receivedDate: '<date>',
            items: [{ foodMasterId: 'food_example_oats', quantity: 0 }],
          },
        },
      ],
    })
  })
})
