import { okAsync } from 'neverthrow'
import { expect, it } from 'vitest'

import type { MealPlanRepository } from '#domain/meal-plan/meal-plan-repository'
import { createMealPlanService } from '#domain/meal-plan/meal-plan-service'
import type { MealPlan } from '#domain/meal-plan/types'
import { jstDate } from '#test/jst-date'

it('returns the same plan id for overlapping saves to one slot', async () => {
  const plans = new Map<string, MealPlan>()
  const repository: MealPlanRepository = {
    save(input) {
      const slot = `${input.date}:${input.mealType}`
      const existing = plans.get(slot)
      const plan: MealPlan = {
        id: existing?.id ?? '00000000-0000-7000-8000-000000000001',
        date: input.date,
        mealType: input.mealType,
        items: input.items,
        reason: input.reason ?? null,
        status: 'planned',
        createdAt: new Date('2026-11-10T03:00:00.000Z'),
      }
      plans.set(slot, plan)
      return okAsync(plan)
    },
    list: () => okAsync(Array.from(plans.values())),
    cancel(id) {
      const plan = Array.from(plans.values()).find(
        (candidate) => candidate.id === id,
      )
      if (plan === undefined) return okAsync(null)
      const cancelled = { ...plan, status: 'cancelled' as const }
      plans.set(`${plan.date}:${plan.mealType}`, cancelled)
      return okAsync(cancelled)
    },
  }
  const service = createMealPlanService({
    repository,
    now: () => new Date('2026-11-10T03:00:00.000Z'),
  })
  const input = {
    date: jstDate('2026-11-10'),
    mealType: 'dinner' as const,
    items: [
      {
        foodMasterId: 'fm_example',
        foodName: 'example food',
        quantity: 1,
      },
    ],
  }

  const saved = await Promise.all([service.save(input), service.save(input)])

  expect(saved.map((result) => result._unsafeUnwrap().id)).toEqual([
    '00000000-0000-7000-8000-000000000001',
    '00000000-0000-7000-8000-000000000001',
  ])
})
