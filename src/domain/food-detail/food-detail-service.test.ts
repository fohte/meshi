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
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 168, protein_g: 2.5 },
      history: [],
      totalEatenCount: 0,
    })
  })

  it('returns the basis quantity/unit for a food registered with a non-gram basis', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_katsudon',
      name: 'かつ丼',
      source: 'user_input',
      basisQuantity: 1,
      basisUnit: '食',
      nutrients: { energy_kcal: 913 },
    })
    const foodMasterService = createFoodMasterService(
      createFoodMasterRepository(tx),
    )
    const service = createFoodDetailService(tx, foodMasterService)

    const result = (await service.getById('fm_katsudon'))._unsafeUnwrap()

    expect(result).toEqual({
      id: 'fm_katsudon',
      name: 'かつ丼',
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      aliases: [],
      basisQuantity: 1,
      basisUnit: '食',
      nutritionPerBasis: { energy_kcal: 913 },
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
      // Non-gram unit: amountGrams (the resolved basis for nutrition) is
      // distinct from quantity (display-only), so this also pins that the
      // service surfaces amountGrams rather than aliasing it to quantity.
      quantity: 1,
      unit: '個',
      amountGrams: 45,
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
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: {},
      history: [
        {
          id: 'ml_newer',
          eatenAt: newerEatenAt,
          mealType: 'snack',
          amountGrams: 45,
          quantity: 1,
          unit: '個',
        },
        {
          id: 'ml_older',
          eatenAt: olderEatenAt,
          mealType: 'breakfast',
          amountGrams: 60,
          quantity: 60,
          unit: 'g',
        },
      ],
      totalEatenCount: 2,
    })
  })
})
