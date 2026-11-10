import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'

import { DayDetailHeader } from '#components/DayDetailHeader/DayDetailHeader'

const meta: Meta<typeof DayDetailHeader> = {
  title: 'components/DayDetailHeader',
  component: DayDetailHeader,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    date: '2026-08-18',
    dateKind: 'today',
    entryCount: 3,
  },
}

export default meta

type Story = StoryObj<typeof DayDetailHeader>

export const RecordedDay: Story = {
  name: '今日の食事記録と品目数を表示しています',
}

export const FutureDay: Story = {
  name: '未来日の食事予定を表示しています',
  args: { dateKind: 'future', entryCount: 0 },
}
