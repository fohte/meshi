import type { Meta, StoryObj } from '@storybook/react-vite'

import {
  type MealSetDraftItem,
  MealSetEditor,
  type MealSetFoodOption,
} from '#components/MealSetEditor/MealSetEditor'

const FOOD_ALPHA: MealSetFoodOption = {
  foodMasterId: 'food_demo_alpha',
  name: '架空食品 A',
  energyKcalPerUnit: 120,
  isEstimated: false,
}

const ITEM_ALPHA: MealSetDraftItem = {
  foodMasterId: FOOD_ALPHA.foodMasterId,
  foodName: FOOD_ALPHA.name,
  quantity: '1',
  energyKcalPerUnit: FOOD_ALPHA.energyKcalPerUnit,
}

const meta: Meta<typeof MealSetEditor> = {
  title: 'components/MealSetEditor',
  component: MealSetEditor,
  args: {
    mode: 'create',
    name: '',
    items: [],
    foodQuery: '',
    recentFoods: [FOOD_ALPHA],
    frequentFoods: [],
    searchResults: [],
    isSearching: false,
    onNameChange: () => undefined,
    onFoodQueryChange: () => undefined,
    onAddFood: () => undefined,
    onQuantityChange: () => undefined,
    onRemoveFood: () => undefined,
    onSave: () => undefined,
    onCancel: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealSetEditor>

export const Creating: Story = {
  name: '食品を追加する前のエディターです',
}

export const Searching: Story = {
  name: '食品名で検索しています',
  args: {
    foodQuery: '架空食品',
    isSearching: true,
    isFoodSearchLoading: true,
  },
}

export const SearchFailed: Story = {
  name: '食品検索に失敗した理由を表示しています',
  args: {
    foodQuery: '架空食品',
    isSearching: true,
    foodSearchError: '食品を検索できませんでした。',
  },
}

export const Editing: Story = {
  name: '選択した食品と量を編集しています',
  args: {
    mode: 'edit',
    name: '作業用セット',
    items: [ITEM_ALPHA],
  },
}

export const SaveFailed: Story = {
  name: '保存に失敗した理由を表示しています',
  args: {
    mode: 'edit',
    name: '作業用セット',
    items: [ITEM_ALPHA],
    error: '同じ名前のマイセットがすでにあります。',
  },
}

export const Saving: Story = {
  name: 'マイセットを保存しています',
  args: {
    mode: 'edit',
    name: '作業用セット',
    items: [ITEM_ALPHA],
    isSaving: true,
  },
}
