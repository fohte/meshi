import type { Meta, StoryObj } from '@storybook/react-vite'

import { HistoryTabs } from '#components/HistoryTabs/HistoryTabs'

const meta = {
  title: 'Components/HistoryTabs',
  component: HistoryTabs,
  args: {
    onViewChange: () => undefined,
  },
} satisfies Meta<typeof HistoryTabs>

export default meta
type Story = StoryObj<typeof meta>

export const CalendarSelected = {
  name: 'the calendar tab is selected',
  args: { activeView: 'calendar' },
} satisfies Story

export const ListSelected = {
  name: 'the list tab is selected',
  args: { activeView: 'list' },
} satisfies Story

export const ReportSelected = {
  name: 'the report tab is selected',
  args: { activeView: 'report' },
} satisfies Story

export const WeightSelected = {
  name: 'the weight tab is selected',
  args: { activeView: 'weight' },
} satisfies Story
