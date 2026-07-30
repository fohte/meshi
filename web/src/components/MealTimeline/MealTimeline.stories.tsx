import type { Meta, StoryObj } from '@storybook/react-vite'

import type { DayDetailEntry } from '#api/day-detail'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'
import { MealTimeline } from '#components/MealTimeline/MealTimeline'

const ENTRIES: ReadonlyArray<DayDetailEntry> = [
  {
    id: 'l1',
    foodMasterId: 'rice',
    foodName: '白米',
    eatenAt: '2026-07-28T23:10:00.000Z',
    mealType: 'breakfast',
    quantity: 150,
    unit: 'g',
    note: null,
    kcal: 234,
    isEstimated: false,
  },
  {
    id: 'l2',
    foodMasterId: 'udon',
    foodName: 'うどん',
    eatenAt: '2026-07-29T03:40:00.000Z',
    mealType: 'lunch',
    quantity: 1,
    unit: '杯',
    note: '会社の近くで',
    kcal: 300,
    isEstimated: false,
  },
  {
    id: 'l3',
    foodMasterId: 'mystery_stew',
    foodName: 'なぞのシチュー',
    eatenAt: '2026-07-29T10:15:00.000Z',
    mealType: 'dinner',
    quantity: 1,
    unit: '皿',
    note: null,
    kcal: 480,
    isEstimated: true,
  },
]

const meta: Meta<typeof MealTimeline> = {
  title: 'components/MealTimeline',
  component: MealTimeline,
}

export default meta

type Story = StoryObj<typeof MealTimeline>

export const Default: Story = {
  args: { groups: buildMealTimelineGroups(ENTRIES, []) },
}

export const Empty: Story = {
  args: { groups: buildMealTimelineGroups([], []) },
}

export const WithSkipsAndUnrecorded: Story = {
  args: {
    groups: buildMealTimelineGroups(
      ENTRIES.filter((entry) => entry.mealType === 'breakfast'),
      ['lunch'],
    ),
  },
}
