import { expect, it } from 'vitest'

import { createFoodSearchService } from '#domain/food-browse/food-search-service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodComposition, seedFoodMaster } from '#test/seed'

describeIfDb('createFoodSearchService', () => {
  const getTx = setupDrizzleTx()

  it('returns registered food matches with per-unit kcal and excludes composition candidates', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_catalog_alpha',
      name: 'item_token_alpha',
      isEstimated: false,
      source: 'user_input',
      nutrients: { energy_kcal: 42 },
    })
    await seedFoodMaster(tx, {
      id: 'fm_catalog_beta',
      name: 'item_token_beta',
      isEstimated: true,
      source: 'user_input',
    })
    await seedFoodComposition(tx, {
      code: 'comp_catalog_alpha',
      name: 'item_token_alpha',
    })
    const service = createFoodSearchService(tx, createDrizzleFoodMatcher(tx))

    const result = (
      await service.searchRegistered(['item_token_alpha', 'item_token_beta'], 5)
    )._unsafeUnwrap()

    expect(result).toEqual([
      {
        foodMasterId: 'fm_catalog_alpha',
        name: 'item_token_alpha',
        isEstimated: false,
        energyKcalPerUnit: 42,
      },
      {
        foodMasterId: 'fm_catalog_beta',
        name: 'item_token_beta',
        isEstimated: true,
        energyKcalPerUnit: null,
      },
    ])
  })
})
