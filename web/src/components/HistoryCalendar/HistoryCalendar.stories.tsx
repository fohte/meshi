import type { Meta, StoryObj } from '@storybook/react-vite'
import { MemoryRouter } from 'react-router'

import { HistoryCalendar } from '#components/HistoryCalendar/HistoryCalendar'
import { buildCalendarCells } from '#pages/history/build-calendar-cells'

const monthStart = '2026-07-01'
const today = '2026-07-10'

const meta: Meta<typeof HistoryCalendar> = {
  title: 'components/HistoryCalendar',
  component: HistoryCalendar,
  decorators: [
    (Story) => (
      <MemoryRouter>
        <Story />
      </MemoryRouter>
    ),
  ],
  args: {
    monthStart,
    cells: buildCalendarCells(
      monthStart,
      today,
      new Map([
        ['2026-07-06', { kcal: 1780, hasUnknownValues: false }],
        ['2026-07-07', { kcal: 2210, hasUnknownValues: false }],
        ['2026-07-08', { kcal: 1960, hasUnknownValues: false }],
      ]),
      2000,
      new Map([
        ['2026-07-12', 1],
        ['2026-07-16', 2],
      ]),
    ),
    averageText: '1,983 kcal',
    onPreviousMonth: () => undefined,
    onNextMonth: () => undefined,
  },
}

export default meta

type Story = StoryObj<typeof HistoryCalendar>

export const PlannedDays: Story = {
  name: '未来日の予定がある日に件数を表示しています',
}

export const UnknownOnlyDay: Story = {
  name: '栄養値が不明な日を表示しています',
  args: {
    cells: buildCalendarCells(
      monthStart,
      today,
      new Map([['2026-07-06', { kcal: undefined, hasUnknownValues: true }]]),
      2000,
    ),
  },
}

export const PartiallyKnownDay: Story = {
  name: '栄養値が一部不明な日の既知分を表示しています',
  args: {
    cells: buildCalendarCells(
      monthStart,
      today,
      new Map([['2026-07-06', { kcal: 600, hasUnknownValues: true }]]),
      2000,
    ),
  },
}
