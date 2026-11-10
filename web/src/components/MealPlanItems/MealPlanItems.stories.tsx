import type { Meta, StoryObj } from '@storybook/react-vite'

import { MealPlanItems } from '#components/MealPlanItems/MealPlanItems'

const meta: Meta<typeof MealPlanItems> = {
  title: 'components/MealPlanItems',
  component: MealPlanItems,
  args: {
    items: [
      { id: 1, foodName: '架空食品 A', quantity: '1', energyKcalPerUnit: 120 },
      { id: 2, foodName: '架空食品 B', quantity: '2', energyKcalPerUnit: null },
    ],
    isSaving: false,
    onQuantityChange: () => undefined,
    onRemoveItem: () => undefined,
    onReplaceItem: () => undefined,
    onAddItem: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealPlanItems>

export const WithItems: Story = {
  name: '食品ごとの量とエネルギー値を確認できます',
}

export const Empty: Story = {
  name: 'まだ食品が追加されていません',
  args: { items: [] },
}
