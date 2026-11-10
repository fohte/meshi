import { expect, it } from 'vitest'

import { createFoodSearchService } from '#domain/food-browse/food-search-service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { jstDate } from '#test/jst-date'
import {
  seedFoodComposition,
  seedFoodCompositionNutrient,
  seedFoodMaster,
  seedFoodMasterNutritionVersion,
  seedFoodMasterWithoutNutrition,
  seedMealLog,
  seedNutrientDefinition,
} from '#test/seed'

describeIfDb('createFoodSearchService', () => {
  const getTx = setupDrizzleTx()

  it('returns registered food matches with per-unit kcal and excludes composition candidates by default', async () => {
    const tx = getTx()
    await seedNutrientDefinition(tx, {
      code: 'energy_kcal',
      displayName: 'Energy',
      unit: 'kcal',
      isMajor: true,
      sortOrder: 0,
    })
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
      source: 'model_estimate',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_catalog_gamma',
      name: 'item_token_gamma',
    })
    await seedMealLog(tx, {
      id: 'ml_catalog_alpha',
      foodMasterId: 'fm_catalog_alpha',
      eatenDate: jstDate('2026-01-15'),
      mealType: 'breakfast',
      quantity: 1.5,
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
        nutrition: { energy_kcal: 42 },
        energyKcalPerUnit: 42,
        lastEatenDate: jstDate('2026-01-15'),
        lastQuantity: 1.5,
      },
      {
        foodMasterId: 'fm_catalog_beta',
        compositionCode: null,
        name: 'item_token_beta',
        isEstimated: true,
        nutritionStatus: 'estimated',
        nutrition: {},
        energyKcalPerUnit: null,
        lastEatenDate: null,
        lastQuantity: null,
      },
      {
        foodMasterId: 'fm_catalog_gamma',
        compositionCode: null,
        name: 'item_token_gamma',
        isEstimated: false,
        nutritionStatus: 'unknown',
        nutrition: {},
        energyKcalPerUnit: null,
        lastEatenDate: null,
        lastQuantity: null,
      },
    ])
  })

  it('returns current major nutrients and omits missing or non-major values', async () => {
    const tx = getTx()
    const majorNutrients = [
      'energy_kcal',
      'protein_g',
      'fat_g',
      'carb_g',
      'dietary_fiber_g',
      'salt_g',
    ]
    for (const [sortOrder, code] of majorNutrients.entries()) {
      await seedNutrientDefinition(tx, {
        code,
        displayName: code,
        unit: code === 'energy_kcal' ? 'kcal' : 'g',
        isMajor: true,
        sortOrder,
      })
    }
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_current_nutrients',
      name: 'item_token_current_nutrients',
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_current_nutrients',
      versionNo: 1,
      isCurrent: false,
      changeKind: 'initial',
      isEstimated: false,
      source: 'user_input',
      nutrients: {
        energy_kcal: 999,
        carb_g: 90,
        salt_g: 8,
      },
    })
    await seedFoodMasterNutritionVersion(tx, {
      foodMasterId: 'fm_current_nutrients',
      versionNo: 2,
      isCurrent: true,
      changeKind: 'product_update',
      isEstimated: false,
      source: 'user_input',
      nutrients: {
        energy_kcal: 0,
        protein_g: 12,
        fat_g: 4,
        dietary_fiber_g: 3,
        saturated_fat_g: 2,
      },
    })
    const service = createFoodSearchService(tx, createDrizzleFoodMatcher(tx))

    const result = (
      await service.search(['item_token_current_nutrients'], 1)
    )._unsafeUnwrap()

    expect(result).toEqual([
      {
        foodMasterId: 'fm_current_nutrients',
        compositionCode: null,
        name: 'item_token_current_nutrients',
        isEstimated: false,
        nutritionStatus: 'confirmed',
        nutrition: {
          energy_kcal: 0,
          protein_g: 12,
          fat_g: 4,
          dietary_fiber_g: 3,
        },
        energyKcalPerUnit: 0,
        lastEatenDate: null,
        lastQuantity: null,
      },
    ])
  })

  it('returns composition candidates with per-100g kcal for homemade searches', async () => {
    const tx = getTx()
    await seedNutrientDefinition(tx, {
      code: 'energy_kcal',
      displayName: 'Energy',
      unit: 'kcal',
      isMajor: true,
      sortOrder: 0,
    })
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
        nutrition: { energy_kcal: 42 },
        energyKcalPerUnit: 42,
        lastEatenDate: null,
        lastQuantity: null,
      },
      {
        foodMasterId: null,
        compositionCode: 'fc_search_fixture_beta',
        name: 'search_fixture_beta',
        isEstimated: true,
        nutritionStatus: 'estimated',
        energyKcalPer100g: 88,
        lastEatenDate: null,
        lastQuantity: null,
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
        lastEatenDate: null,
        lastQuantity: null,
      },
    ])
  })
})
