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
  nutritionVersion: {
    versionNo: 1,
    changeKind: 'initial',
    source: 'web_search',
    isEstimated: false,
    checkedOn: '2026-07-20',
    effectiveFrom: null,
  },
  nutritionVersionOrigin: 'recorded',
  nutritionVersionDifferences: [],
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
            isUnknown: false,
            hasNutritionVersionDifferences: false,
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
            isUnknown: false,
            hasNutritionVersionDifferences: false,
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
            isUnknown: false,
            hasNutritionVersionDifferences: false,
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
            nutritionVersion: null,
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
            hasNutritionVersionDifferences: false,
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

  it('shows unknown kcal when a confirmed entry has no energy value', () => {
    expect(
      buildMealTimelineGroups(
        [
          entry({
            id: 'l3',
            foodMasterId: 'partial-food',
            foodName: '栄養値が一部不明の食事',
            mealType: 'lunch',
            quantity: 1,
            kcal: null,
            isEstimated: false,
            nutritionStatus: 'confirmed',
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
        status: 'eaten',
        kcalText: '不明',
        items: [
          {
            id: 'l3',
            name: '栄養値が一部不明の食事',
            isEstimated: false,
            isUnknown: true,
            hasNutritionVersionDifferences: false,
            quantityText: '×1',
            kcalText: '不明',
          },
        ],
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

  it('marks different nutrition versions without changing existing nutrition marks or kcal', () => {
    const differences = [
      {
        versionNo: 9,
        changeKind: 'product_update' as const,
        source: 'web_search' as const,
        isEstimated: false,
        checkedOn: '2026-10-12',
        effectiveFrom: null,
      },
    ]

    expect(
      buildMealTimelineGroups(
        [
          entry({
            id: 'entry_diff',
            foodName: '比較用メニュー',
            quantity: 1,
            kcal: 80,
            nutritionVersion: {
              versionNo: 8,
              changeKind: 'initial',
              source: 'web_search',
              isEstimated: false,
              checkedOn: '2026-10-10',
              effectiveFrom: null,
            },
            nutritionVersionDifferences: differences,
          }),
          entry({
            id: 'entry_estimated_diff',
            mealType: 'lunch',
            foodName: '推定の比較用メニュー',
            quantity: 1,
            kcal: 90,
            isEstimated: true,
            nutritionStatus: 'estimated',
            nutritionVersion: {
              versionNo: 8,
              changeKind: 'initial',
              source: 'model_estimate',
              isEstimated: true,
              checkedOn: null,
              effectiveFrom: null,
            },
            nutritionVersionDifferences: differences,
          }),
        ],
        [],
      ),
    ).toEqual([
      {
        mealType: 'breakfast',
        label: '朝食',
        status: 'eaten',
        kcalText: '80 kcal',
        items: [
          {
            id: 'entry_diff',
            name: '比較用メニュー',
            isEstimated: false,
            isUnknown: false,
            hasNutritionVersionDifferences: true,
            quantityText: '×1',
            kcalText: '80 kcal',
          },
        ],
      },
      {
        mealType: 'lunch',
        label: '昼食',
        status: 'eaten',
        kcalText: '90 kcal',
        items: [
          {
            id: 'entry_estimated_diff',
            name: '推定の比較用メニュー',
            isEstimated: true,
            isUnknown: false,
            hasNutritionVersionDifferences: true,
            quantityText: '×1',
            kcalText: '90 kcal',
          },
        ],
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
