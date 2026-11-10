import type { Meta, StoryObj } from '@storybook/react-vite'

import type { MealPlanSheetProps } from '#components/MealPlanSheet/MealPlanSheet'
import { MealPlanSheet } from '#components/MealPlanSheet/MealPlanSheet'

const items: MealPlanSheetProps['items'] = [
  {
    id: 1,
    foodMasterId: 'fixture_food_a',
    foodName: '架空食品 A',
    quantity: '1',
    energyKcalPerUnit: 125,
  },
  {
    id: 2,
    foodMasterId: 'fixture_food_b',
    foodName: '架空食品 B',
    quantity: '2',
    energyKcalPerUnit: null,
  },
]

const meta: Meta<typeof MealPlanSheet> = {
  title: 'components/MealPlanSheet',
  component: MealPlanSheet,
  args: {
    date: '2026-08-18',
    mealType: 'dinner',
    isEditing: false,
    reason: '夜に作る予定',
    items,
    selection: null,
    query: '',
    isSaving: false,
    error: null,
    isRegisteringComposition: false,
    compositionError: false,
    close: () => undefined,
    setReason: () => undefined,
    setQuery: () => undefined,
    selectFood: () => undefined,
    selectComposition: () => undefined,
    backToItems: () => undefined,
    setQuantity: () => undefined,
    removeItem: () => undefined,
    replaceItem: () => undefined,
    addItem: () => undefined,
    save: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealPlanSheet>

export const Create: Story = {
  name: '夕食の予定に食品と理由を入力しています',
  args: { items: [] },
}

export const Edit: Story = {
  name: '登録済みの予定を編集しています',
  args: { isEditing: true },
}
