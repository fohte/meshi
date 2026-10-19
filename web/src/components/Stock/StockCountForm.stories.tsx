import type { Meta, StoryObj } from '@storybook/react-vite'

import type { StockCountFormProps } from '#components/Stock/StockCountForm'
import { StockCountForm } from '#components/Stock/StockCountForm'

const ITEMS: StockCountFormProps['stockItems'] = [
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

const meta: Meta<typeof StockCountForm> = {
  title: 'components/Stock/StockCountForm',
  component: StockCountForm,
  args: {
    stockItems: ITEMS,
    foodMasterId: 'food_example_herbs',
    quantity: '1.5',
    receivedDate: '',
    bestBefore: '',
    isSaving: false,
    onFoodMasterIdChange: () => undefined,
    onQuantityChange: () => undefined,
    onReceivedDateChange: () => undefined,
    onBestBeforeChange: () => undefined,
    onSubmit: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof StockCountForm>

export const ReadyToRecord: Story = {
  name: '記録上の残数を見ながら端数の実数を入力しています',
}

export const RecordingZero: Story = {
  name: '数えた実数がゼロです',
  args: { foodMasterId: 'food_example_crackers', quantity: '0' },
}

export const RecordingAnIncrease: Story = {
  name: '増えた実数と新たな入荷分の日付を入力しています',
  args: {
    quantity: '2.5',
    receivedDate: '2026-08-12',
    bestBefore: '2026-09-20',
  },
}

export const Saving: Story = {
  name: '保存中は入力と送信が無効です',
  args: { isSaving: true },
}

export const SaveFailed: Story = {
  name: '保存に失敗した理由を表示して再試行できます',
  args: { error: '在庫の記録に失敗しました。' },
}
