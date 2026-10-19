import type { Meta, StoryObj } from '@storybook/react-vite'

import { StockDeliveryConfirmation } from '#components/Stock/StockDeliveryConfirmation'

const meta: Meta<typeof StockDeliveryConfirmation> = {
  title: 'components/Stock/StockDeliveryConfirmation',
  component: StockDeliveryConfirmation,
  args: {
    mode: 'receive',
    sourceRef: 'order_example_42',
    expectedDate: '2026-11-14',
    receivedDate: '2026-11-15',
    items: [
      {
        foodMasterId: 'food_example_oats',
        foodName: '架空オーツ',
        quantity: 0,
      },
    ],
    isSubmitting: false,
    onBack: () => undefined,
    onConfirm: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof StockDeliveryConfirmation>

export const ReceiveConfirmation: Story = {
  name: '受領する配送と実数を確認しています',
}

export const CancelConfirmation: Story = {
  name: 'meshi の入荷予定を取り消す内容を確認しています',
  args: {
    mode: 'cancel',
    receivedDate: null,
  },
}

export const ConfirmingWhileSubmitting: Story = {
  name: '受領の確定を送信しています',
  args: { isSubmitting: true },
}
