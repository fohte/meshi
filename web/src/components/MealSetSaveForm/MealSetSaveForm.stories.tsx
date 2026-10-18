import type { Meta, StoryObj } from '@storybook/react-vite'

import { MealSetSaveForm } from '#components/MealSetSaveForm/MealSetSaveForm'

const meta: Meta<typeof MealSetSaveForm> = {
  title: 'components/MealSetSaveForm',
  component: MealSetSaveForm,
  args: {
    id: 'meal-set-save-breakfast',
    mealLabel: '朝食',
    name: '',
    onNameChange: () => undefined,
    onSave: () => undefined,
    onCancel: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealSetSaveForm>

export const EditingName: Story = {
  name: '食事のマイセット名を入力しています',
  args: { name: 'テストセット_001' },
}

export const Saving: Story = {
  name: '食事のマイセットを保存しています',
  args: { name: 'テストセット_001', isSaving: true },
}

export const SaveFailed: Story = {
  name: 'マイセット名の重複理由を表示しています',
  args: {
    name: 'テストセット_001',
    error: 'meal_set with name already exists: テストセット_001',
  },
}

export const Saved: Story = {
  name: '食事のマイセットを保存した状態です',
  args: {
    name: 'テストセット_001',
    successMessage: '「テストセット_001」をマイセットに保存しました。',
  },
}
