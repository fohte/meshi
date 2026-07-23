import { expect, it } from 'vitest'

import { createDrizzleMealLogRepository } from '@/domain/meal-log/drizzle-meal-log-repository'
import { FoodMasterNotFoundError } from '@/domain/meal-log/errors'
import type { MealLogRow } from '@/domain/meal-log/types'
import { describeIfDb, setupDrizzleTx } from '@/test/db'
import { seedFoodMaster } from '@/test/seed'

const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const normalizeRow = (row: MealLogRow): MealLogRow => ({
  ...row,
  createdAt: CREATED_AT_PLACEHOLDER,
})

describeIfDb('createDrizzleMealLogRepository', () => {
  const getTx = setupDrizzleTx()

  it('returns a FoodMasterNotFoundError when the food_master_id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)
    const error = (
      await repo.findFoodMaster('fm_does_not_exist')
    )._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(FoodMasterNotFoundError)
    expect(
      error instanceof FoodMasterNotFoundError ? error.foodMasterId : undefined,
    ).toBe('fm_does_not_exist')
  })

  it('round-trips a meal log through insertMealLog + findMealLogById', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLog({
        id: 'ml_round',
        foodMasterId: 'fm_rice',
        eatenAt: new Date('2026-06-15T03:30:00.000Z'),
        quantity: 150,
        unit: 'g',
        note: 'breakfast',
      })
    )._unsafeUnwrap()
    const fetched = (await repo.findMealLogById('ml_round'))._unsafeUnwrap()

    const expectedRow: MealLogRow = {
      id: 'ml_round',
      foodMasterId: 'fm_rice',
      eatenAt: new Date('2026-06-15T03:30:00.000Z'),
      quantity: 150,
      unit: 'g',
      note: 'breakfast',
      createdAt: CREATED_AT_PLACEHOLDER,
    }

    expect(normalizeRow(inserted)).toEqual(expectedRow)
    expect(
      fetched === null
        ? null
        : { log: normalizeRow(fetched.log), food: fetched.food },
    ).toEqual({
      log: expectedRow,
      food: {
        id: 'fm_rice',
        name: '白米',
        isEstimated: false,
        nutritionPer100g: {
          protein_g: 2.5,
          carb_g: 37.1,
        },
      },
    })
  })

  it('returns null from findMealLogById when the id is unknown', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)
    expect(
      (await repo.findMealLogById('ml_missing'))._unsafeUnwrap(),
    ).toBeNull()
  })
})
