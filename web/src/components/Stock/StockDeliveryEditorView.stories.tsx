import type { Meta, StoryObj } from '@storybook/react-vite'

import type { StockStatus } from '#api/stock'
import type { StockDeliveryEditorViewProps } from '#components/Stock/stock-delivery-editor-types'
import { StockDeliveryEditorView } from '#components/Stock/StockDeliveryEditorView'

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
  {
    foodMasterId: 'food_example_tea',
    foodName: '架空茶葉',
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

const meta: Meta<typeof StockDeliveryEditorView> = {
  title: 'components/Stock/StockDeliveryEditorView',
  component: StockDeliveryEditorView,
  args: {
    mode: 'create',
    delivery: null,
    stockItems: STOCK_ITEMS,
    isSubmitting: false,
    draft: {
      sourceRef: '',
      expectedDate: '2026-11-14',
      changeDeadline: '',
      receivedDate: '2026-11-15',
      items: [{ foodMasterId: '', quantity: '' }],
    },
    isConfirming: false,
    onClose: () => undefined,
    onDraftChange: () => undefined,
    onItemChange: () => undefined,
    onAddItem: () => undefined,
    onRemoveItem: () => undefined,
    onFormSubmit: (event) => {
      event.preventDefault()
    },
    onConfirmationBack: () => undefined,
    onConfirmationConfirm: () => undefined,
  } satisfies Partial<StockDeliveryEditorViewProps>,
}

export default meta

type Story = StoryObj<typeof StockDeliveryEditorView>

export const Creating: Story = {
  name: '注文番号付きの入荷予定を登録しています',
}

export const Editing: Story = {
  name: '注文番号を固定して予定の内容を変更しています',
  args: {
    mode: 'edit',
    delivery: DELIVERY,
    draft: {
      sourceRef: 'order_example_42',
      expectedDate: DELIVERY.expectedDate,
      changeDeadline: DELIVERY.changeDeadline ?? '',
      receivedDate: '2026-11-15',
      items: [{ foodMasterId: 'food_example_oats', quantity: '2' }],
    },
  },
}

export const ReceivingWithoutOrderNumber: Story = {
  name: '注文番号のない配送の実数を入力しています',
  args: {
    mode: 'receive',
    delivery: { ...DELIVERY, sourceRef: null },
    draft: {
      sourceRef: '',
      expectedDate: DELIVERY.expectedDate,
      changeDeadline: '',
      receivedDate: '2026-11-15',
      items: [{ foodMasterId: 'food_example_oats', quantity: '0' }],
    },
  },
}

export const ReviewingCancellation: Story = {
  name: '注文先の注文とは別に meshi の予定取消を確認しています',
  args: { mode: 'cancel', delivery: DELIVERY },
}

export const SaveFailed: Story = {
  name: '予定の保存に失敗した理由を表示しています',
  args: { error: '入力内容を確認してください。' },
}

export const Saving: Story = {
  name: '配送予定を保存しています',
  args: { isSubmitting: true },
}
