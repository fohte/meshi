import { describe, expect, it } from 'vitest'

import type { DayDetailEntry } from '#api/day-detail'
import { buildDayMealSetInput } from '#pages/build-day-meal-set-input'

const entry = (overrides: Partial<DayDetailEntry>): DayDetailEntry => ({
  id: 'entry_fixture_001',
  foodMasterId: 'food_fixture_001',
  foodName: 'テスト食品_001',
  eatenDate: '2093-04-12',
  mealType: 'breakfast',
  quantity: 1,
  kcal: 120,
  isEstimated: false,
  nutritionStatus: 'confirmed',
  nutritionVersion: {
    versionNo: 1,
    changeKind: 'initial',
    source: 'web_search',
    isEstimated: false,
    checkedOn: '2093-04-02',
    effectiveFrom: '2093-04-01',
  },
  nutritionVersionOrigin: 'recorded',
  nutritionVersionDifferences: [],
  ...overrides,
})

describe('buildDayMealSetInput', () => {
  it('merges repeated foods and preserves the meal item order', () => {
    expect(
      buildDayMealSetInput(
        [
          entry({ quantity: 1.5 }),
          entry({
            id: 'entry_fixture_002',
            foodMasterId: 'food_fixture_002',
            foodName: 'テスト食品_002',
            quantity: 0.5,
          }),
          entry({ id: 'entry_fixture_003', quantity: 2 }),
          entry({
            id: 'entry_fixture_other_meal',
            mealType: 'lunch',
            foodMasterId: 'food_fixture_lunch',
          }),
        ],
        'breakfast',
        'テストセット_001',
      ),
    ).toEqual({
      name: 'テストセット_001',
      items: [
        { foodMasterId: 'food_fixture_001', quantity: 3.5 },
        { foodMasterId: 'food_fixture_002', quantity: 0.5 },
      ],
    })
  })
})
