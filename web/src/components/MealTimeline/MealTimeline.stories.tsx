import type { Meta, StoryObj } from '@storybook/react-vite'

import type { DayDetailEntry } from '#api/day-detail'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'
import { MealTimeline } from '#components/MealTimeline/MealTimeline'

const ENTRIES: ReadonlyArray<DayDetailEntry> = [
  {
    id: 'l1',
    foodMasterId: 'rice',
    foodName: '白米',
    eatenDate: '2026-07-29',
    mealType: 'breakfast',
    quantity: 150,
    kcal: 234,
    isEstimated: false,
  },
  {
    id: 'l2',
    foodMasterId: 'udon',
    foodName: 'うどん',
    eatenDate: '2026-07-29',
    mealType: 'lunch',
    quantity: 1,
    kcal: 300,
    isEstimated: false,
  },
  {
    id: 'l3',
    foodMasterId: 'mystery_stew',
    foodName: 'なぞのシチュー',
    eatenDate: '2026-07-29',
    mealType: 'dinner',
    quantity: 1,
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
