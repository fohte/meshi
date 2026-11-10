import { describe, expect, it } from 'vitest'

import type { MealPlan } from '#api/meal-plans'
import { buildPlannedCountByDate } from '#pages/history/build-planned-counts'

const mealPlan = (
  date: string,
  status: MealPlan['status'],
  id: string,
): MealPlan => ({
  id,
  date,
  mealType: 'breakfast',
  reason: null,
  status,
  items: [],
})

describe('buildPlannedCountByDate', () => {
  it('counts only planned meal plans after today', () => {
    const mealPlans = [
      mealPlan('2026-07-04', 'planned', 'past-planned'),
      mealPlan('2026-07-05', 'planned', 'today-planned'),
      mealPlan('2026-07-06', 'planned', 'future-planned-a'),
      mealPlan('2026-07-06', 'planned', 'future-planned-b'),
      mealPlan('2026-07-06', 'cancelled', 'future-cancelled'),
      mealPlan('2026-07-06', 'eaten', 'future-eaten'),
    ]

    expect(buildPlannedCountByDate(mealPlans, '2026-07-05')).toEqual(
      new Map([['2026-07-06', 2]]),
    )
  })
})
