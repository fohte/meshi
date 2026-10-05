import { describe, expect, it } from 'vitest'

import { createFoodBrowseService } from '#domain/food-browse/food-browse-service'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { toJstDateString } from '#lib/jst-date'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodComposition, seedFoodMaster, seedMealLog } from '#test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY)

describeIfDb('createFoodBrowseService', () => {
  const getTx = setupDrizzleTx()

  describe('search', () => {
    it('enriches a food_master match with its source and per-unit kcal', async () => {
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
          energyKcalPerUnit: 52,
        },
      ])
    })

    it('leaves energyKcalPerUnit null when the food has no energy_kcal row', async () => {
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
          energyKcalPerUnit: null,
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
          energyKcalPerUnit: null,
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
        eatenDate: toJstDateString(daysAgo(5)),
        mealType: 'breakfast',
        quantity: 100,
      })
      await seedMealLog(tx, {
        id: 'ml_newer',
        foodMasterId: 'fm_newer',
        eatenDate: toJstDateString(daysAgo(1)),
        mealType: 'breakfast',
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
          energyKcalPerUnit: null,
        },
        {
          foodMasterId: 'fm_older',
          compositionCode: null,
          name: 'older food',
          isEstimated: false,
          reason: 'history_recent',
          source: 'user_input',
          energyKcalPerUnit: 10,
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
        eatenDate: toJstDateString(daysAgo(1)),
        mealType: 'breakfast',
        quantity: 100,
      })
      await seedMealLog(tx, {
        id: 'ml_b',
        foodMasterId: 'fm_b',
        eatenDate: toJstDateString(daysAgo(2)),
        mealType: 'breakfast',
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
          energyKcalPerUnit: null,
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
          eatenDate: toJstDateString(daysAgo(i + 1)),
          mealType: 'breakfast',
          quantity: 100,
        })
      }
      await seedMealLog(tx, {
        id: 'ml_rare',
        foodMasterId: 'fm_rare',
        eatenDate: toJstDateString(daysAgo(1)),
        mealType: 'breakfast',
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
          energyKcalPerUnit: 20,
        },
        {
          foodMasterId: 'fm_rare',
          compositionCode: null,
          name: 'rare food',
          isEstimated: false,
          reason: 'history_frequent',
          source: 'user_input',
          energyKcalPerUnit: null,
        },
      ])
    })
  })
})
