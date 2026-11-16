import type { Meta, StoryObj } from '@storybook/react-vite'

import { GoalWeightSection } from '#components/GoalWeightSection/GoalWeightSection'

const meta: Meta<typeof GoalWeightSection> = {
  title: 'components/GoalWeightSection',
  component: GoalWeightSection,
  args: {
    goalWeightKg: null,
    onSave: () => undefined,
    onClear: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof GoalWeightSection>

export const Unset: Story = {
  name: '目標体重が未設定です',
}

export const Configured: Story = {
  name: '目標体重を設定しています',
  args: { goalWeightKg: 62.5 },
}
