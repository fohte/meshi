import { expect, it } from 'vitest'

import {
  createDrizzleMealPlanRepository,
  createMealPlanService,
} from '#domain/meal-plan/index'
import type { MealPlan } from '#domain/meal-plan/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import { seedFoodMasterWithoutNutrition } from '#test/seed'

const FIXED_NOW = new Date('2026-11-10T03:00:00.000Z')
const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const observation = <T extends object>(value: T): T => value

const normalizeMealPlan = (plan: MealPlan): MealPlan => ({
  ...plan,
  createdAt: CREATED_AT_PLACEHOLDER,
})

const normalizePlanIds = (
  plans: ReadonlyArray<MealPlan>,
): ReadonlyArray<MealPlan> => {
  const ids = new Map<string, string>()
  return plans.map((plan) => {
    let normalizedId = ids.get(plan.id)
    if (normalizedId === undefined) {
      normalizedId = `plan-${String(ids.size + 1)}`
      ids.set(plan.id, normalizedId)
    }
    return { ...normalizeMealPlan(plan), id: normalizedId }
  })
}

describeIfDb('MealPlanService with DrizzleMealPlanRepository', () => {
  const getTx = setupDrizzleTx()

  const buildService = (wrapInTransaction = true) =>
    createMealPlanService({
      repository: createDrizzleMealPlanRepository(getTx(), {
        wrapInTransaction,
      }),
      now: () => FIXED_NOW,
    })

  const seedFoods = async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_plan_alpha',
      name: 'alpha sample food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_plan_beta',
      name: 'beta sample food',
    })
  }

  const activityCounts = async () => {
    const tx = getTx()
    const rows = await tx<{ meal_logs: string; stock_movements: string }[]>`
      SELECT
        (SELECT count(*)::text FROM meal_logs) AS meal_logs,
        (SELECT count(*)::text FROM stock_movements) AS stock_movements
    `
    return rows[0]
  }

  it('replaces items and reason in the same date and meal type slot', async () => {
    await seedFoods()
    const service = buildService()
    const first = await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_alpha',
          foodName: 'alpha sample food',
          quantity: 1,
        },
      ],
      reason: 'first reason',
    })
    const firstId = first._unsafeUnwrap().id
    const replaced = await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_beta',
          foodName: 'beta sample food',
          quantity: 2,
        },
      ],
      reason: 'updated reason',
    })

    expect(normalizeMealPlan(replaced._unsafeUnwrap())).toEqual({
      id: firstId,
      date: '2026-11-10',
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_beta',
          foodName: 'beta sample food',
          quantity: 2,
        },
      ],
      reason: 'updated reason',
      status: 'planned',
      createdAt: CREATED_AT_PLACEHOLDER,
    })
  })

  it('rejects a date before today', async () => {
    const result = await buildService().save({
      date: jstDate('2026-11-09'),
      mealType: 'breakfast',
      items: [
        {
          foodMasterId: 'fm_meal_plan_alpha',
          foodName: 'alpha sample food',
          quantity: 1,
        },
      ],
    })

    expect(result.isErr() ? result.error.code : 'ok').toEqual(
      'meal_plan/past_date',
    )
  })

  it('rejects an empty item list', async () => {
    const result = await buildService().save({
      date: jstDate('2026-11-10'),
      mealType: 'breakfast',
      items: [],
    })

    expect(result.isErr() ? result.error.code : 'ok').toEqual(
      'meal_plan/empty_items',
    )
  })

  it('lists the half-open date range and includes cancelled plans with status', async () => {
    await seedFoods()
    const service = buildService()
    const item = {
      foodMasterId: 'fm_meal_plan_alpha',
      foodName: 'alpha sample food',
      quantity: 1,
    }
    await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'breakfast',
      items: [item],
      reason: 'morning',
    })
    const cancelled = await service.save({
      date: jstDate('2026-11-11'),
      mealType: 'dinner',
      items: [item],
      reason: 'evening',
    })
    await service.cancel(cancelled._unsafeUnwrap().id)
    await service.save({
      date: jstDate('2026-11-12'),
      mealType: 'snack',
      items: [item],
    })

    const plans = await service.list(
      jstDate('2026-11-10'),
      jstDate('2026-11-12'),
    )
    expect(normalizePlanIds(plans._unsafeUnwrap())).toEqual([
      {
        id: 'plan-1',
        date: '2026-11-10',
        mealType: 'breakfast',
        items: [item],
        reason: 'morning',
        status: 'planned',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      {
        id: 'plan-2',
        date: '2026-11-11',
        mealType: 'dinner',
        items: [item],
        reason: 'evening',
        status: 'cancelled',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
    ])
  })

  it('cancels a plan without changing meal logs or stock movements', async () => {
    await seedFoods()
    const service = buildService()
    const plan = await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_alpha',
          foodName: 'alpha sample food',
          quantity: 1,
        },
      ],
    })
    const before = await activityCounts()
    const cancelled = await service.cancel(plan._unsafeUnwrap().id)
    const after = await activityCounts()

    expect(
      observation({
        status: cancelled._unsafeUnwrap().status,
        before,
        after,
      }),
    ).toEqual({
      status: 'cancelled',
      before: { meal_logs: '0', stock_movements: '0' },
      after: before,
    })
  })

  it('does not change meal logs or stock movements when saving or replacing plans', async () => {
    await seedFoods()
    const service = buildService()
    const before = await activityCounts()
    await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_alpha',
          foodName: 'alpha sample food',
          quantity: 1,
        },
      ],
    })
    await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_beta',
          foodName: 'beta sample food',
          quantity: 2,
        },
      ],
    })
    const after = await activityCounts()

    expect(observation({ before, after })).toEqual({
      before: { meal_logs: '0', stock_movements: '0' },
      after: before,
    })
  })
})
