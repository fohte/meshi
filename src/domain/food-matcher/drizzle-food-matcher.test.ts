import { describe, expect, it } from 'vitest'

import type { FoodMatchCandidate } from '@/domain/food-matcher'
import { createDrizzleFoodMatcher } from '@/domain/food-matcher'
import { describeIfDb, setupTx } from '@/test/db'
import { seedFoodComposition, seedFoodMaster, seedMealLog } from '@/test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// A Date `daysAgo` days before now, for a meal_log's eaten_at. The scoring
// formula only reads days_since at ~day granularity, and scores are rounded
// to 3dp before asserting, so the sub-second gap between this call and the
// eventual SELECT is negligible.
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY)

// Round score to 3 decimal places so the assertion is robust against the tiny
// drift between INSERT-side now() and SELECT-side now().
const normalize = (
  rows: ReadonlyArray<FoodMatchCandidate>,
): ReadonlyArray<FoodMatchCandidate> =>
  rows.map((r) => ({ ...r, score: Number(r.score.toFixed(3)) }))

// pg_trgm similarity is deterministic for fixed inputs. These constants are
// the values returned by `similarity()` in Postgres 17 with default settings;
// rounding to 3dp absorbs the float32 imprecision in the comparison.
const SIM_RICE_RICE_X = 0.714
const SIM_SOUP_SOUP_X = 0.714
const SIM_BREAD_BREAD_E = 0.75
const SIM_CURRY_CURRY_F = 0.75

describeIfDb('createDrizzleFoodMatcher', () => {
  const getTx = setupTx()

  describe('history-based matches', () => {
    it('ranks recently-eaten foods above older ones, both as history_recent', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_recent_a',
        name: 'rice_a',
        source: 'user_input',
      })
      await seedFoodMaster(tx, {
        id: 'fm_recent_b',
        name: 'rice_b',
        source: 'user_input',
      })
      await seedMealLog(tx, {
        id: 'ml_ra',
        foodMasterId: 'fm_recent_a',
        eatenAt: daysAgo(1),
        quantity: 1,
      })
      await seedMealLog(tx, {
        id: 'ml_rb',
        foodMasterId: 'fm_recent_b',
        eatenAt: daysAgo(5),
        quantity: 1,
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'rice', limit: 5 })

      const expectedA = Number((2 + SIM_RICE_RICE_X * 0.5).toFixed(3))
      const expectedB = Number((2 + SIM_RICE_RICE_X * (1 / (1 + 5))).toFixed(3))
      expect(normalize(result)).toEqual([
        {
          reason: 'history_recent',
          score: expectedA,
          foodMasterId: 'fm_recent_a',
          compositionCode: null,
          name: 'rice_a',
          isEstimated: false,
        },
        {
          reason: 'history_recent',
          score: expectedB,
          foodMasterId: 'fm_recent_b',
          compositionCode: null,
          name: 'rice_b',
          isEstimated: false,
        },
      ])
    })

    it('marks old-but-frequent foods as history_frequent above one-off (fuzzy_name) matches', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_freq_c',
        name: 'soup_c',
        source: 'user_input',
      })
      await seedFoodMaster(tx, {
        id: 'fm_freq_d',
        name: 'soup_d',
        source: 'user_input',
      })
      for (let i = 0; i < 5; i++) {
        await seedMealLog(tx, {
          id: `ml_fc_${String(i)}`,
          foodMasterId: 'fm_freq_c',
          eatenAt: daysAgo(30),
          quantity: 1,
        })
      }
      await seedMealLog(tx, {
        id: 'ml_fd',
        foodMasterId: 'fm_freq_d',
        eatenAt: daysAgo(30),
        quantity: 1,
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'soup', limit: 5 })

      const expectedC = Number(
        (1 + SIM_SOUP_SOUP_X * (1 - Math.exp(-5 / 3))).toFixed(3),
      )
      expect(normalize(result)).toEqual([
        {
          reason: 'history_frequent',
          score: expectedC,
          foodMasterId: 'fm_freq_c',
          compositionCode: null,
          name: 'soup_c',
          isEstimated: false,
        },
        {
          reason: 'fuzzy_name',
          score: Number(SIM_SOUP_SOUP_X.toFixed(3)),
          foodMasterId: 'fm_freq_d',
          compositionCode: null,
          name: 'soup_d',
          isEstimated: false,
        },
      ])
    })
  })

  describe('non-history matches', () => {
    it('returns fuzzy_name candidates when the name matches but there is no history', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_fuzz',
        name: 'bread_e',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'bread', limit: 5 })

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: Number(SIM_BREAD_BREAD_E.toFixed(3)),
          foodMasterId: 'fm_fuzz',
          compositionCode: null,
          name: 'bread_e',
          isEstimated: false,
        },
      ])
    })

    it('falls back to the composition table when no food_master matches', async () => {
      const tx = getTx()
      await seedFoodComposition(tx, { code: 'comp_noodle', name: 'noodle' })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'noodle', limit: 5 })

      expect(normalize(result)).toEqual([
        {
          reason: 'composition_table',
          score: 1,
          foodMasterId: null,
          compositionCode: 'comp_noodle',
          name: 'noodle',
          isEstimated: true,
        },
      ])
    })

    it('suppresses composition fallback when a food_master already matches', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_curry',
        name: 'curry_f',
        source: 'user_input',
      })
      await seedFoodComposition(tx, { code: 'comp_curry', name: 'curry' })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'curry', limit: 5 })

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: Number(SIM_CURRY_CURRY_F.toFixed(3)),
          foodMasterId: 'fm_curry',
          compositionCode: null,
          name: 'curry_f',
          isEstimated: false,
        },
      ])
    })

    it('returns an empty array when nothing matches', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_other',
        name: 'pasta_g',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = await matcher.search({ query: 'tofu', limit: 5 })

      expect(result).toEqual([])
    })
  })
})
