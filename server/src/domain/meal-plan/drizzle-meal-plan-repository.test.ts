import type { Result } from 'neverthrow'
import { expect, it } from 'vitest'

import type { MealPlanDomainError } from '#domain/meal-plan/errors'
import {
  createDrizzleMealPlanRepository,
  createMealPlanService,
} from '#domain/meal-plan/index'
import type { MealPlan } from '#domain/meal-plan/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
} from '#test/seed'

const FIXED_NOW = new Date('2026-11-09T16:00:00.000Z')
const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const observation = <T extends object>(value: T): T => value

const normalizeMealPlan = (plan: MealPlan): MealPlan => ({
  ...plan,
  id: 'meal-plan-id',
  createdAt: CREATED_AT_PLACEHOLDER,
})

const errorShape = <Value>(
  result: Result<Value, MealPlanDomainError>,
): {
  code: string
  message: string
  details: Readonly<Record<string, unknown>>
} | null =>
  result.isErr()
    ? {
        code: result.error.code,
        message: result.error.message,
        details: result.error.details,
      }
    : null

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

    const replacedPlan = replaced._unsafeUnwrap()
    expect(
      observation({
        plan: normalizeMealPlan(replacedPlan),
        keptId: replacedPlan.id === firstId,
      }),
    ).toEqual({
      plan: {
        id: 'meal-plan-id',
        date: '2026-11-10',
        mealType: 'lunch',
        items: [
          {
            foodMasterId: 'fm_meal_plan_beta',
            foodName: 'beta sample food',
            quantity: 2,
            energyKcalPerUnit: null,
          },
        ],
        reason: 'updated reason',
        status: 'planned',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      keptId: true,
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

    expect(errorShape(result)).toEqual({
      code: 'meal_plan/past_date',
      message: 'planned date must not be before today: 2026-11-09',
      details: { date: '2026-11-09' },
    })
  })

  it('rejects an empty item list', async () => {
    const result = await buildService().save({
      date: jstDate('2026-11-10'),
      mealType: 'breakfast',
      items: [],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_plan/empty_items',
      message: 'items must not be empty',
      details: {},
    })
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
        items: [{ ...item, energyKcalPerUnit: null }],
        reason: 'morning',
        status: 'planned',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      {
        id: 'plan-2',
        date: '2026-11-11',
        mealType: 'dinner',
        items: [{ ...item, energyKcalPerUnit: null }],
        reason: 'evening',
        status: 'cancelled',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
    ])
  })

  it('returns current per-unit kcal and null when it is unavailable', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_plan_with_kcal',
      name: 'example food with nutrition',
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_meal_plan_with_kcal',
      versionNo: 1,
      isCurrent: false,
      changeKind: 'initial',
      source: 'user_input',
      nutrients: { energy_kcal: 12 },
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_meal_plan_with_kcal',
      versionNo: 2,
      isCurrent: true,
      changeKind: 'product_update',
      source: 'user_input',
      nutrients: { energy_kcal: 47.5 },
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_plan_without_kcal',
      name: 'example food without nutrition',
    })
    const service = buildService()
    await service.save({
      date: jstDate('2026-11-10'),
      mealType: 'lunch',
      items: [
        {
          foodMasterId: 'fm_meal_plan_with_kcal',
          foodName: 'example food with nutrition',
          quantity: 1,
        },
        {
          foodMasterId: 'fm_meal_plan_without_kcal',
          foodName: 'example food without nutrition',
          quantity: 2,
        },
      ],
    })

    const plans = await service.list(
      jstDate('2026-11-10'),
      jstDate('2026-11-11'),
    )

    expect(plans._unsafeUnwrap()[0]?.items).toEqual([
      {
        foodMasterId: 'fm_meal_plan_with_kcal',
        foodName: 'example food with nutrition',
        quantity: 1,
        energyKcalPerUnit: 47.5,
      },
      {
        foodMasterId: 'fm_meal_plan_without_kcal',
        foodName: 'example food without nutrition',
        quantity: 2,
        energyKcalPerUnit: null,
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
    const savedPlan = plan._unsafeUnwrap()
    const cancelled = await service.cancel(savedPlan.id)
    const after = await activityCounts()

    expect(
      observation({
        plan: normalizeMealPlan(cancelled._unsafeUnwrap()),
        before,
        after,
      }),
    ).toEqual({
      plan: {
        id: 'meal-plan-id',
        date: '2026-11-10',
        mealType: 'lunch',
        items: [
          {
            foodMasterId: 'fm_meal_plan_alpha',
            foodName: 'alpha sample food',
            quantity: 1,
            energyKcalPerUnit: null,
          },
        ],
        reason: null,
        status: 'cancelled',
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      before: { meal_logs: '0', stock_movements: '0' },
      after: { meal_logs: '0', stock_movements: '0' },
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
