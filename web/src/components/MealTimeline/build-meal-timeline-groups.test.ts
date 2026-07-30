import { describe, expect, it } from 'vitest'

import type { DayDetailEntry } from '#api/day-detail'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'

const entry = (overrides: Partial<DayDetailEntry>): DayDetailEntry => ({
  id: 'log-1',
  foodMasterId: 'rice',
  foodName: 'ごはん',
  eatenAt: '2026-07-28T23:00:00.000Z', // 08:00 JST
  mealType: 'breakfast',
  quantity: 150,
  unit: 'g',
  note: null,
  kcal: 234,
  isEstimated: false,
  ...overrides,
})

describe('buildMealTimelineGroups', () => {
  it('always returns 4 groups in a fixed order, assigning eaten/skipped/unrecorded status', () => {
    const entries = [
      entry({
        id: 'l1',
        eatenAt: '2026-07-28T23:00:00.000Z', // 08:00 JST breakfast
        mealType: 'breakfast',
        foodName: '白米',
        quantity: 150,
        kcal: 234,
      }),
      entry({
        id: 'l3',
        eatenAt: '2026-07-29T03:30:00.000Z', // 12:30 JST lunch
        mealType: 'lunch',
        foodName: 'うどん',
        quantity: 1,
        unit: '杯',
        kcal: 300,
      }),
    ]

    expect(buildMealTimelineGroups(entries, ['dinner'])).toEqual([
      {
        mealType: 'breakfast',
        label: '朝食',
        status: 'eaten',
        kcalText: '234 kcal',
        items: [
          {
            id: 'l1',
            time: '08:00',
            name: '白米',
            isEstimated: false,
            quantityText: '150 g',
            kcalText: '234 kcal',
            note: null,
          },
        ],
      },
      {
        mealType: 'lunch',
        label: '昼食',
        status: 'eaten',
        kcalText: '300 kcal',
        items: [
          {
            id: 'l3',
            time: '12:30',
            name: 'うどん',
            isEstimated: false,
            quantityText: '1 杯',
            kcalText: '300 kcal',
            note: null,
          },
        ],
      },
      {
        mealType: 'dinner',
        label: '夕食',
        status: 'skipped',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'snack',
        label: '間食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
    ])
  })

  it('returns 4 unrecorded groups when there are no entries and no skips', () => {
    expect(buildMealTimelineGroups([], [])).toEqual([
      {
        mealType: 'breakfast',
        label: '朝食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'lunch',
        label: '昼食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'dinner',
        label: '夕食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'snack',
        label: '間食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
    ])
  })

  it('formats a fractional quantity with one decimal place', () => {
    const entries = [
      entry({ id: 'l1', mealType: 'breakfast', quantity: 1.5, unit: '杯' }),
    ]

    expect(buildMealTimelineGroups(entries, [])).toEqual([
      {
        mealType: 'breakfast',
        label: '朝食',
        status: 'eaten',
        kcalText: '234 kcal',
        items: [
          {
            id: 'l1',
            time: '08:00',
            name: 'ごはん',
            isEstimated: false,
            quantityText: '1.5 杯',
            kcalText: '234 kcal',
            note: null,
          },
        ],
      },
      {
        mealType: 'lunch',
        label: '昼食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'dinner',
        label: '夕食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
      {
        mealType: 'snack',
        label: '間食',
        status: 'unrecorded',
        kcalText: null,
        items: [],
      },
    ])
  })
})
