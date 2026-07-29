import { expect, it } from 'vitest'

import { createFoodDetailService } from '#domain/food-detail/food-detail-service'
import {
  createFoodMasterRepository,
  createFoodMasterService,
} from '#domain/food-master/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMaster, seedFoodMasterAlias, seedMealLog } from '#test/seed'

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
      source: 'user_input',
      sourceUrl: null,
      aliases: ['ご飯'],
      nutritionPer100g: { energy_kcal: 168, protein_g: 2.5 },
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
      eatenAt: olderEatenAt,
      mealType: 'breakfast',
      quantity: 60,
      unit: 'g',
    })
    await seedMealLog(tx, {
      id: 'ml_newer',
      foodMasterId: 'fm_bread',
      eatenAt: newerEatenAt,
      mealType: 'snack',
      quantity: 30,
      unit: 'g',
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
      source: 'web_search',
      sourceUrl: 'https://example.com/bread',
      aliases: [],
      nutritionPer100g: {},
      history: [
        {
          id: 'ml_newer',
          eatenAt: newerEatenAt,
          mealType: 'snack',
          quantity: 30,
          unit: 'g',
        },
        {
          id: 'ml_older',
          eatenAt: olderEatenAt,
          mealType: 'breakfast',
          quantity: 60,
          unit: 'g',
        },
      ],
      totalEatenCount: 2,
    })
  })
})
