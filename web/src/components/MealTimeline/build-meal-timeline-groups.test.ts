import { describe, expect, it } from 'vitest'

import type { DayDetailEntry } from '#api/day-detail'
import { buildMealTimelineGroups } from '#components/MealTimeline/build-meal-timeline-groups'

const entry = (overrides: Partial<DayDetailEntry>): DayDetailEntry => ({
  id: 'log-1',
  foodMasterId: 'rice',
  foodName: 'ごはん',
  eatenDate: '2026-07-29',
  mealType: 'breakfast',
  quantity: 150,
  kcal: 234,
  isEstimated: false,
  nutritionStatus: 'confirmed',
  ...overrides,
})

describe('buildMealTimelineGroups', () => {
  it('assigns status "eaten" with items and kcalText to a mealType with entries', () => {
    const entries = [
      entry({
        id: 'l1',
        eatenDate: '2026-07-29',
        mealType: 'breakfast',
        foodName: '白米',
        quantity: 150,
        kcal: 234,
      }),
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
            name: '白米',
            isEstimated: false,
            quantityText: '×150',
            kcalText: '234 kcal',
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

  it('assigns status "skipped" with no items to a mealType passed in skippedMealTypes', () => {
    expect(buildMealTimelineGroups([], ['dinner'])).toEqual([
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

  it('assigns status "unrecorded" to a mealType with neither an entry nor a skip', () => {
    const entries = [
      entry({
        id: 'l1',
        eatenDate: '2026-07-29',
        mealType: 'breakfast',
        foodName: '白米',
        quantity: 150,
        kcal: 234,
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
            name: '白米',
            isEstimated: false,
            quantityText: '×150',
            kcalText: '234 kcal',
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
    const entries = [entry({ id: 'l1', mealType: 'breakfast', quantity: 1.5 })]

    expect(buildMealTimelineGroups(entries, [])).toEqual([
      {
        mealType: 'breakfast',
        label: '朝食',
        status: 'eaten',
        kcalText: '234 kcal',
        items: [
          {
            id: 'l1',
            name: 'ごはん',
            isEstimated: false,
            quantityText: '×1.5',
            kcalText: '234 kcal',
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

  it('shows unknown kcal for an entry without nutrition values', () => {
    expect(
      buildMealTimelineGroups(
        [
          entry({
            id: 'l2',
            foodMasterId: 'unknown-food',
            foodName: '不明なメニュー',
            mealType: 'dinner',
            quantity: 1,
            kcal: null,
            isEstimated: false,
            nutritionStatus: 'unknown',
          }),
        ],
        [],
      ),
    ).toEqual([
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
        status: 'eaten',
        kcalText: '不明',
        items: [
          {
            id: 'l2',
            name: '不明なメニュー',
            isEstimated: false,
            isUnknown: true,
            quantityText: '×1',
            kcalText: '不明',
          },
        ],
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
