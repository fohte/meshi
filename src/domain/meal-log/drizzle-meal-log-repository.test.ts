import { expect, it } from 'vitest'

import { createDrizzleMealLogRepository } from '#domain/meal-log/drizzle-meal-log-repository'
import {
  FoodMasterNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { MealLogRow } from '#domain/meal-log/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMaster, seedFoodMasterUnit } from '#test/seed'

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
    await seedFoodMasterUnit(tx, {
      foodMasterId: 'fm_rice',
      unit: '杯',
      gramsPerUnit: 150,
    })
    const repo = createDrizzleMealLogRepository(tx)

    const inserted = (
      await repo.insertMealLog({
        id: 'ml_round',
        foodMasterId: 'fm_rice',
        eatenDate: '2026-06-15',
        mealType: 'breakfast',
        quantity: 150,
        unit: 'g',
        amountGrams: 150,
      })
    )._unsafeUnwrap()
    const fetched = (await repo.findMealLogById('ml_round'))._unsafeUnwrap()

    const expectedRow: MealLogRow = {
      id: 'ml_round',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 150,
      unit: 'g',
      amountGrams: 150,
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
        nutritionPerBasis: {
          protein_g: 2.5,
          carb_g: 37.1,
        },
        basisQuantity: 100,
        basisUnit: 'g',
        units: { 杯: 150 },
      },
    })
  })

  it('round-trips a non-default basis (1, 食) through findFoodMaster and findMealLogById', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_katsudon',
      name: '味噌ロースかつ丼',
      isEstimated: false,
      source: 'user_input',
      basisQuantity: 1,
      basisUnit: '食',
      nutrients: { energy_kcal: 913 },
    })
    const repo = createDrizzleMealLogRepository(tx)

    const foundMaster = (
      await repo.findFoodMaster('fm_katsudon')
    )._unsafeUnwrap()
    expect(foundMaster).toEqual({
      id: 'fm_katsudon',
      name: '味噌ロースかつ丼',
      isEstimated: false,
      nutritionPerBasis: { energy_kcal: 913 },
      basisQuantity: 1,
      basisUnit: '食',
      units: {},
    })

    await repo.insertMealLog({
      id: 'ml_katsudon',
      foodMasterId: 'fm_katsudon',
      eatenDate: '2026-06-15',
      mealType: 'dinner',
      quantity: 1,
      unit: '食',
      amountGrams: 1,
    })
    const fetched = (await repo.findMealLogById('ml_katsudon'))._unsafeUnwrap()
    expect(fetched === null ? null : fetched.food).toEqual({
      id: 'fm_katsudon',
      name: '味噌ロースかつ丼',
      isEstimated: false,
      nutritionPerBasis: { energy_kcal: 913 },
      basisQuantity: 1,
      basisUnit: '食',
      units: {},
    })
  })

  it('returns null from findMealLogById when the id is unknown', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)
    expect(
      (await repo.findMealLogById('ml_missing'))._unsafeUnwrap(),
    ).toBeNull()
  })

  it('updateMealLog patches only the given fields and leaves the rest untouched', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_patch',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 150,
      unit: 'g',
      amountGrams: 150,
    })

    // amountGrams is deliberately omitted from this patch — at the
    // repository level (below MealLogService.update's resolution) it's
    // just another optional field, and this test's whole point is that
    // fields absent from the patch are left untouched.
    const updated = (
      await repo.updateMealLog({
        id: 'ml_patch',
        quantity: 200,
      })
    )._unsafeUnwrap()

    expect(normalizeRow(updated)).toEqual({
      id: 'ml_patch',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 200,
      unit: 'g',
      amountGrams: 150,
      createdAt: CREATED_AT_PLACEHOLDER,
    })
  })

  it('updateMealLog patches amountGrams when given one', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_patch_grams',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 1,
      unit: '杯',
      amountGrams: 100,
    })

    const updated = (
      await repo.updateMealLog({ id: 'ml_patch_grams', amountGrams: 150 })
    )._unsafeUnwrap()

    expect(normalizeRow(updated)).toEqual({
      id: 'ml_patch_grams',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 1,
      unit: '杯',
      amountGrams: 150,
      createdAt: CREATED_AT_PLACEHOLDER,
    })
  })

  it('updateMealLog re-points food_master_id at another existing food_master', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
      nutrients: { protein_g: 2.5, carb_g: 37.1 },
    })
    await seedFoodMaster(tx, {
      id: 'fm_karaage',
      name: '唐揚げ',
      isEstimated: true,
      source: 'user_input',
      nutrients: { protein_g: 24.2, carb_g: 7.9 },
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_repoint',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'lunch',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
    })

    await repo.updateMealLog({ id: 'ml_repoint', foodMasterId: 'fm_karaage' })
    const fetched = (await repo.findMealLogById('ml_repoint'))._unsafeUnwrap()

    expect(
      fetched === null
        ? null
        : { log: normalizeRow(fetched.log), food: fetched.food },
    ).toEqual({
      log: {
        id: 'ml_repoint',
        foodMasterId: 'fm_karaage',
        eatenDate: '2026-06-15',
        mealType: 'lunch',
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      food: {
        id: 'fm_karaage',
        name: '唐揚げ',
        isEstimated: true,
        nutritionPerBasis: {
          protein_g: 24.2,
          carb_g: 7.9,
        },
        basisQuantity: 100,
        basisUnit: 'g',
        units: {},
      },
    })
  })

  it('updateMealLog returns a MealLogPersistenceError when the id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)

    const error = (
      await repo.updateMealLog({ id: 'ml_missing', quantity: 1 })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(MealLogPersistenceError)
  })

  it('deleteMealLog removes the row and returns true', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: '白米',
      isEstimated: false,
      source: 'user_input',
    })
    const repo = createDrizzleMealLogRepository(tx)
    await repo.insertMealLog({
      id: 'ml_delete',
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-15',
      mealType: 'breakfast',
      quantity: 150,
      unit: 'g',
      amountGrams: 150,
    })

    expect((await repo.deleteMealLog('ml_delete'))._unsafeUnwrap()).toBe(true)
    expect((await repo.findMealLogById('ml_delete'))._unsafeUnwrap()).toBeNull()
  })

  it('deleteMealLog returns false when the id does not exist', async () => {
    const tx = getTx()
    const repo = createDrizzleMealLogRepository(tx)

    expect((await repo.deleteMealLog('ml_missing'))._unsafeUnwrap()).toBe(false)
  })
})
