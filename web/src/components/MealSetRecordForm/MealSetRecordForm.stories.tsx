import type { Meta, StoryObj } from '@storybook/react-vite'

import type { MealSetRecordFormProps } from '#components/MealSetRecordForm/MealSetRecordForm'
import { MealSetRecordForm } from '#components/MealSetRecordForm/MealSetRecordForm'

const ITEMS: MealSetRecordFormProps['items'] = [
  {
    id: 0,
    foodName: '架空食品 A',
    quantity: '1',
    energyKcalPerUnit: 120,
  },
  {
    id: 1,
    foodName: '架空食品 B',
    quantity: '2',
    energyKcalPerUnit: null,
  },
]

const meta: Meta<typeof MealSetRecordForm> = {
  title: 'components/MealSetRecordForm',
  component: MealSetRecordForm,
  args: {
    mealSetName: '作業用セット',
    items: ITEMS,
    date: '2026-01-01',
    mealType: 'breakfast',
    isSaving: false,
    onQuantityChange: () => undefined,
    onRemoveItem: () => undefined,
    onReplaceItem: () => undefined,
    onAddItem: () => undefined,
    onMealTypeChange: () => undefined,
    onDateChange: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealSetRecordForm>

export const Reviewing: Story = {
  name: '品目と量を確認して食事区分と日付を選べます',
}

export const Empty: Story = {
  name: '品目をすべて削除した状態です',
  args: { items: [] },
}

export const SaveFailed: Story = {
  name: '失敗した品目を特定して表示しています',
  args: { error: '品目 2 の記録に失敗しました。' },
}
