import type { Meta, StoryObj } from '@storybook/react-vite'

import type { MealSet } from '#api/meal-sets'
import { MealSetPicker } from '#components/MealSetPicker/MealSetPicker'

const SAMPLE_MEAL_SET: MealSet = {
  id: 'ms_demo_alpha',
  name: '作業用セット',
  items: [
    {
      foodMasterId: 'fm_demo_alpha',
      foodName: '架空食品 A',
      quantity: 1,
      energyKcalPerUnit: 120,
    },
    {
      foodMasterId: 'fm_demo_beta',
      foodName: '架空食品 B',
      quantity: 2,
      energyKcalPerUnit: null,
    },
  ],
  createdAt: '2026-01-01T00:00:00.000Z',
}

const meta: Meta<typeof MealSetPicker> = {
  title: 'components/MealSetPicker',
  component: MealSetPicker,
  args: {
    mealSets: [SAMPLE_MEAL_SET],
    isLoading: false,
    onSelect: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealSetPicker>

export const Available: Story = {
  name: '保存済みのマイセットを選べます',
}

export const Loading: Story = {
  name: 'マイセットを読み込んでいます',
  args: { mealSets: [], isLoading: true },
}

export const Empty: Story = {
  name: '保存済みのマイセットがありません',
  args: { mealSets: [] },
}

export const Failed: Story = {
  name: 'マイセットを取得できなかった理由を表示しています',
  args: { mealSets: [], error: 'マイセットを取得できませんでした。' },
}
