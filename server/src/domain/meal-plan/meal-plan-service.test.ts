import { errAsync, okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import { MealPlanPersistenceError } from '#domain/meal-plan/errors'
import type { MealPlanRepository } from '#domain/meal-plan/meal-plan-repository'
import { createMealPlanService } from '#domain/meal-plan/meal-plan-service'
import { jstDate } from '#test/jst-date'

it('rejects duplicate food IDs before saving a plan', async () => {
  let saveCalls = 0
  const repository: MealPlanRepository = {
    save: () => {
      saveCalls += 1
      return errAsync(new MealPlanPersistenceError('unexpected save'))
    },
    list: () => okAsync([]),
    cancel: () => okAsync(null),
  }
  const service = createMealPlanService({
    repository,
    now: () => new Date('2026-11-10T03:00:00.000Z'),
  })
  const result = await service.save({
    date: jstDate('2026-11-10'),
    mealType: 'dinner',
    items: [
      {
        foodMasterId: 'fm_example',
        foodName: 'example food',
        quantity: 1,
      },
      {
        foodMasterId: 'fm_example',
        foodName: 'example food',
        quantity: 2,
      },
    ],
  })

  const observation = () => ({
    code: result.isErr() ? result.error.code : 'ok',
    saveCalls,
  })

  expect(observation()).toEqual({
    code: 'meal_plan/duplicate_food_master',
    saveCalls: 0,
  })
})
