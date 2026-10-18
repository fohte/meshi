import type { Meta, StoryObj } from '@storybook/react-vite'

import { MealTypeSelector } from '#components/MealTypeSelector/MealTypeSelector'

const meta: Meta<typeof MealTypeSelector> = {
  title: 'components/MealTypeSelector',
  component: MealTypeSelector,
  args: {
    value: null,
    disabled: false,
    onChange: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof MealTypeSelector>

export const NoSelection: Story = {
  name: '食事区分をまだ選んでいません',
}

export const DinnerSelected: Story = {
  name: '夕食が選択されています',
  args: { value: 'dinner' },
}

export const Disabled: Story = {
  name: '保存中のため食事区分を変更できません',
  args: { value: 'lunch', disabled: true },
}
