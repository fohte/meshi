import { expect, it } from 'vitest'

import { createFoodSearchService } from '#domain/food-browse/food-search-service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import {
  seedFoodComposition,
  seedFoodCompositionNutrient,
  seedFoodMaster,
  seedFoodMasterWithoutNutrition,
} from '#test/seed'

describeIfDb('createFoodSearchService', () => {
  const getTx = setupDrizzleTx()

  it('returns registered food matches with per-unit kcal and excludes composition candidates by default', async () => {
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
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_catalog_gamma',
      name: 'item_token_gamma',
    })
    await seedFoodComposition(tx, {
      code: 'comp_catalog_alpha',
      name: 'item_token_alpha',
    })
    const service = createFoodSearchService(tx, createDrizzleFoodMatcher(tx))

    const result = (
      await service.search(
        ['item_token_alpha', 'item_token_beta', 'item_token_gamma'],
        5,
      )
    )._unsafeUnwrap()

    expect(result).toEqual([
      {
        foodMasterId: 'fm_catalog_alpha',
        compositionCode: null,
        name: 'item_token_alpha',
        isEstimated: false,
        nutritionStatus: 'confirmed',
        energyKcalPerUnit: 42,
      },
      {
        foodMasterId: 'fm_catalog_beta',
        compositionCode: null,
        name: 'item_token_beta',
        isEstimated: true,
        nutritionStatus: 'estimated',
        energyKcalPerUnit: null,
      },
      {
        foodMasterId: 'fm_catalog_gamma',
        compositionCode: null,
        name: 'item_token_gamma',
        isEstimated: false,
        nutritionStatus: 'unknown',
        energyKcalPerUnit: null,
      },
    ])
  })

  it('returns composition candidates with per-100g kcal for homemade searches', async () => {
    const tx = getTx()
    await seedFoodMaster(tx, {
      id: 'fm_search_fixture_alpha',
      name: 'search_fixture_alpha',
      isEstimated: false,
      source: 'user_input',
      nutrients: { energy_kcal: 42 },
    })
    await seedFoodComposition(tx, {
      code: 'fc_search_fixture_beta',
      name: 'search_fixture_beta',
    })
    await seedFoodCompositionNutrient(tx, {
      foodCompositionCode: 'fc_search_fixture_beta',
      nutrientCode: 'energy_kcal',
      value: 88,
      unit: 'kcal',
    })
    const service = createFoodSearchService(tx, createDrizzleFoodMatcher(tx))

    const result = (
      await service.search(
        ['search_fixture_alpha', 'search_fixture_beta'],
        5,
        'homemade',
      )
    )._unsafeUnwrap()

    expect(result).toEqual([
      {
        foodMasterId: 'fm_search_fixture_alpha',
        compositionCode: null,
        name: 'search_fixture_alpha',
        isEstimated: false,
        nutritionStatus: 'confirmed',
        energyKcalPerUnit: 42,
      },
      {
        foodMasterId: null,
        compositionCode: 'fc_search_fixture_beta',
        name: 'search_fixture_beta',
        isEstimated: true,
        nutritionStatus: 'estimated',
        energyKcalPer100g: 88,
      },
    ])
  })

  it('keeps composition candidates without an energy row', async () => {
    const tx = getTx()
    await seedFoodComposition(tx, {
      code: 'fc_search_fixture_gamma',
      name: 'search_fixture_gamma',
    })
    const service = createFoodSearchService(tx, createDrizzleFoodMatcher(tx))

    const result = (
      await service.search(['search_fixture_gamma'], 5, 'homemade')
    )._unsafeUnwrap()

    expect(result).toEqual([
      {
        foodMasterId: null,
        compositionCode: 'fc_search_fixture_gamma',
        name: 'search_fixture_gamma',
        isEstimated: true,
        nutritionStatus: 'estimated',
        energyKcalPer100g: null,
      },
    ])
  })
})
