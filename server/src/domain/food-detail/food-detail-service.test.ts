import { expect, it } from 'vitest'

import { createFoodDetailService } from '#domain/food-detail/food-detail-service'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '#domain/food-master/index'
import { toJstDateString } from '#lib/jst-date'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodMaster,
  seedFoodMasterAlias,
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
} from '#test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY)

describeIfDb('createFoodDetailService', () => {
  const getTx = setupDrizzleTx()

  it('returns null when the food_master does not exist', async () => {
    const tx = getTx()
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )
    const service = createFoodDetailService(tx, foodMasterService)

    const result = (await service.getById('fm_missing'))._unsafeUnwrap()

    expect(result).toBeNull()
  })

  it('returns the master, aliases, and nutrition with no history', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_rice',
      name: 'rice',
      source: 'user_input',
      nutrients: { energy_kcal: 168, protein_g: 2.5 },
    })
    await seedFoodMasterAlias(tx, {
      id: 'fma_1',
      foodMasterId: 'fm_rice',
      alias: 'ご飯',
    })
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )
    const service = createFoodDetailService(tx, foodMasterService)

    const result = (await service.getById('fm_rice'))._unsafeUnwrap()

    expect(result).toEqual({
      id: 'fm_rice',
      name: 'rice',
      isEstimated: false,
      nutritionStatus: 'confirmed',
      source: 'user_input',
      sourceUrl: null,
      aliases: ['ご飯'],
      nutrition: { energy_kcal: 168, protein_g: 2.5 },
      history: [],
      totalEatenCount: 0,
    })
  })

  it('returns eat history ordered newest first, with a matching total count', async () => {
    const tx = getTx()
    const olderEatenAt = daysAgo(3)
    const newerEatenAt = daysAgo(1)
    await seedFoodMaster(tx, {
      id: 'fm_bread',
      name: 'bread',
      source: 'web_search',
      sourceUrl: 'https://example.com/bread',
    })
    await seedMealLog(tx, {
      id: 'ml_older',
      foodMasterId: 'fm_bread',
      eatenDate: toJstDateString(olderEatenAt),
      mealType: 'breakfast',
      quantity: 60,
    })
    await seedMealLog(tx, {
      id: 'ml_newer',
      foodMasterId: 'fm_bread',
      eatenDate: toJstDateString(newerEatenAt),
      mealType: 'snack',
      quantity: 1,
    })
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )
    const service = createFoodDetailService(tx, foodMasterService)

    const result = (await service.getById('fm_bread'))._unsafeUnwrap()

    expect(result).toEqual({
      id: 'fm_bread',
      name: 'bread',
      isEstimated: false,
      nutritionStatus: 'confirmed',
      source: 'web_search',
      sourceUrl: 'https://example.com/bread',
      aliases: [],
      nutrition: {},
      history: [
        {
          id: 'ml_newer',
          eatenDate: toJstDateString(newerEatenAt),
          mealType: 'snack',
          quantity: 1,
          energyKcalPerUnit: null,
        },
        {
          id: 'ml_older',
          eatenDate: toJstDateString(olderEatenAt),
          mealType: 'breakfast',
          quantity: 60,
          energyKcalPerUnit: null,
        },
      ],
      totalEatenCount: 2,
    })
  })

  it('returns an unknown food and its meal log in the detail', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_unknown',
      name: 'unknown food',
    })
    await seedMealLog(tx, {
      id: 'ml_unknown',
      foodMasterId: 'fm_unknown',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'dinner',
      quantity: 1,
    })
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )
    const service = createFoodDetailService(tx, foodMasterService)

    const result = (await service.getById('fm_unknown'))._unsafeUnwrap()

    expect(result).toEqual({
      id: 'fm_unknown',
      name: 'unknown food',
      isEstimated: false,
      nutritionStatus: 'unknown',
      source: null,
      sourceUrl: null,
      aliases: [],
      nutrition: {},
      history: [
        {
          id: 'ml_unknown',
          eatenDate: '2026-06-15',
          mealType: 'dinner',
          quantity: 1,
          energyKcalPerUnit: null,
        },
      ],
      totalEatenCount: 1,
    })
  })

  it('returns the nutrition value referenced by each historical meal log', async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_versioned',
      name: 'versioned food',
    })
    const oldVersionId = await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_versioned',
      versionNo: 1,
      isCurrent: false,
      changeKind: 'initial',
      source: 'user_input',
      nutrients: { energy_kcal: 11 },
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_versioned',
      versionNo: 2,
      isCurrent: true,
      changeKind: 'product_update',
      source: 'user_input',
      nutrients: { energy_kcal: 23 },
    })
    await seedMealLog(tx, {
      id: 'ml_versioned',
      foodMasterId: 'fm_versioned',
      nutritionVersionId: oldVersionId,
      nutritionVersionOrigin: 'migrated',
      eatenDate: jstDate('2026-06-15'),
      mealType: 'dinner',
      quantity: 2,
    })
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )

    const result = (
      await createFoodDetailService(tx, foodMasterService).getById(
        'fm_versioned',
      )
    )._unsafeUnwrap()

    expect(result === null ? null : result.history).toEqual([
      {
        id: 'ml_versioned',
        eatenDate: '2026-06-15',
        mealType: 'dinner',
        quantity: 2,
        energyKcalPerUnit: 11,
      },
    ])
  })
})
