import { describe, expect, it } from 'vitest'

import { createFoodBrowseService } from '#domain/food-browse/food-browse-service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodComposition, seedFoodMaster, seedMealLog } from '#test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY)

describeIfDb('createFoodBrowseService', () => {
  const getTx = setupDrizzleTx()

  describe('search', () => {
    it('enriches a food_master match with its source and per-100g kcal', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_apple',
        name: 'apple_x',
        source: 'user_input',
        nutrients: { energy_kcal: 52 },
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('apple', 5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_apple',
          compositionCode: null,
          name: 'apple_x',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'user_input',
          energyKcalPer100g: 52,
        },
      ])
    })

    it('leaves energyKcalPer100g null when the food has no energy_kcal row', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_apricot',
        name: 'apricot_y',
        source: 'web_search',
        sourceUrl: 'https://example.test/apricot',
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('apricot', 5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_apricot',
          compositionCode: null,
          name: 'apricot_y',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'web_search',
          energyKcalPer100g: null,
        },
      ])
    })

    it('leaves source and kcal null for a composition_table fallback candidate', async () => {
      const tx = getTx()
      await seedFoodComposition(tx, { code: 'comp_noodle', name: 'noodle' })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('noodle', 5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: null,
          compositionCode: 'comp_noodle',
          name: 'noodle',
          isEstimated: true,
          reason: 'composition_table',
          source: null,
          energyKcalPer100g: null,
        },
      ])
    })

    it('leaves energyKcalPer100g null for a non-gram basis, even with an energy_kcal value', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_katsudon',
        name: 'katsudon_z',
        source: 'user_input',
        basisQuantity: 1,
        basisUnit: '食',
        nutrients: { energy_kcal: 913 },
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('katsudon', 5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_katsudon',
          compositionCode: null,
          name: 'katsudon_z',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'user_input',
          energyKcalPer100g: null,
        },
      ])
    })

    it('scales energyKcalPer100g from a non-default gram basis', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_halfcup',
        name: 'halfcup_w',
        source: 'user_input',
        basisQuantity: 50,
        basisUnit: 'g',
        nutrients: { energy_kcal: 84 },
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('halfcup', 5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_halfcup',
          compositionCode: null,
          name: 'halfcup_w',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'user_input',
          energyKcalPer100g: 168,
        },
      ])
    })

    it('returns an empty array for a blank query', async () => {
      const tx = getTx()
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.search('', 5))._unsafeUnwrap()

      expect(result).toEqual([])
    })
  })

  describe('listRecent', () => {
    it('orders foods by most recently eaten, newest first', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_older',
        name: 'older food',
        source: 'user_input',
        nutrients: { energy_kcal: 10 },
      })
      await seedFoodMaster(tx, {
        id: 'fm_newer',
        name: 'newer food',
        source: 'user_input',
      })
      await seedMealLog(tx, {
        id: 'ml_older',
        foodMasterId: 'fm_older',
        eatenAt: daysAgo(5),
        quantity: 100,
      })
      await seedMealLog(tx, {
        id: 'ml_newer',
        foodMasterId: 'fm_newer',
        eatenAt: daysAgo(1),
        quantity: 100,
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.listRecent(5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_newer',
          compositionCode: null,
          name: 'newer food',
          isEstimated: false,
          reason: 'history_recent',
          source: 'user_input',
          energyKcalPer100g: null,
        },
        {
          foodMasterId: 'fm_older',
          compositionCode: null,
          name: 'older food',
          isEstimated: false,
          reason: 'history_recent',
          source: 'user_input',
          energyKcalPer100g: 10,
        },
      ])
    })

    it('honors the limit', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_a',
        name: 'food a',
        source: 'user_input',
      })
      await seedFoodMaster(tx, {
        id: 'fm_b',
        name: 'food b',
        source: 'user_input',
      })
      await seedMealLog(tx, {
        id: 'ml_a',
        foodMasterId: 'fm_a',
        eatenAt: daysAgo(1),
        quantity: 100,
      })
      await seedMealLog(tx, {
        id: 'ml_b',
        foodMasterId: 'fm_b',
        eatenAt: daysAgo(2),
        quantity: 100,
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.listRecent(1))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_a',
          compositionCode: null,
          name: 'food a',
          isEstimated: false,
          reason: 'history_recent',
          source: 'user_input',
          energyKcalPer100g: null,
        },
      ])
    })
  })

  describe('listFrequent', () => {
    it('orders foods by eaten count, highest first', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_frequent',
        name: 'frequent food',
        source: 'user_input',
        nutrients: { energy_kcal: 20 },
      })
      await seedFoodMaster(tx, {
        id: 'fm_rare',
        name: 'rare food',
        source: 'user_input',
      })
      for (let i = 0; i < 3; i++) {
        await seedMealLog(tx, {
          id: `ml_frequent_${String(i)}`,
          foodMasterId: 'fm_frequent',
          eatenAt: daysAgo(i + 1),
          quantity: 100,
        })
      }
      await seedMealLog(tx, {
        id: 'ml_rare',
        foodMasterId: 'fm_rare',
        eatenAt: daysAgo(1),
        quantity: 100,
      })
      const service = createFoodBrowseService(tx, createDrizzleFoodMatcher(tx))

      const result = (await service.listFrequent(5))._unsafeUnwrap()

      expect(result).toEqual([
        {
          foodMasterId: 'fm_frequent',
          compositionCode: null,
          name: 'frequent food',
          isEstimated: false,
          reason: 'history_frequent',
          source: 'user_input',
          energyKcalPer100g: 20,
        },
        {
          foodMasterId: 'fm_rare',
          compositionCode: null,
          name: 'rare food',
          isEstimated: false,
          reason: 'history_frequent',
          source: 'user_input',
          energyKcalPer100g: null,
        },
      ])
    })
  })
})
