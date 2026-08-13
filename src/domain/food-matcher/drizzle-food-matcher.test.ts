import { describe, expect, it } from 'vitest'

import type { FoodMatchCandidate } from '#domain/food-matcher/index'
import { createDrizzleFoodMatcher } from '#domain/food-matcher/index'
import { toJstDateString } from '#lib/jst-date'
import { describeIfDb, setupTx } from '#test/db'
import {
  seedFoodComposition,
  seedFoodMaster,
  seedFoodMasterAlias,
  seedMealLog,
} from '#test/seed'

const MS_PER_DAY = 24 * 60 * 60 * 1000

// A Date `daysAgo` days before now, converted via toJstDateString into a
// meal_log's eaten_date.
const daysAgo = (n: number): Date => new Date(Date.now() - n * MS_PER_DAY)

// Round score/nameSim to 3 decimal places so the assertion is robust
// against pg_trgm's float32 imprecision.
const normalize = (
  rows: ReadonlyArray<FoodMatchCandidate>,
): ReadonlyArray<FoodMatchCandidate> =>
  rows.map((r) => ({
    ...r,
    score: Number(r.score.toFixed(3)),
    nameSim: Number(r.nameSim.toFixed(3)),
  }))

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
        eatenDate: toJstDateString(daysAgo(1)),
        mealType: 'breakfast',
        quantity: 1,
      })
      await seedMealLog(tx, {
        id: 'ml_rb',
        foodMasterId: 'fm_recent_b',
        eatenDate: toJstDateString(daysAgo(5)),
        mealType: 'breakfast',
        quantity: 1,
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['rice'], limit: 5 })
      )._unsafeUnwrap()

      const expectedA = Number((2 + 1 * 0.5).toFixed(3))
      const expectedB = Number((2 + 1 * (1 / (1 + 5))).toFixed(3))
      expect(normalize(result)).toEqual([
        {
          reason: 'history_recent',
          score: expectedA,
          nameSim: 1,
          foodMasterId: 'fm_recent_a',
          compositionCode: null,
          name: 'rice_a',
          isEstimated: false,
          matchedQueries: ['rice'],
        },
        {
          reason: 'history_recent',
          score: expectedB,
          nameSim: 1,
          foodMasterId: 'fm_recent_b',
          compositionCode: null,
          name: 'rice_b',
          isEstimated: false,
          matchedQueries: ['rice'],
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
          eatenDate: toJstDateString(daysAgo(30)),
          mealType: 'breakfast',
          quantity: 1,
        })
      }
      await seedMealLog(tx, {
        id: 'ml_fd',
        foodMasterId: 'fm_freq_d',
        eatenDate: toJstDateString(daysAgo(30)),
        mealType: 'breakfast',
        quantity: 1,
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['soup'], limit: 5 })
      )._unsafeUnwrap()

      const expectedC = Number((1 + 1 * (1 - Math.exp(-5 / 3))).toFixed(3))
      expect(normalize(result)).toEqual([
        {
          reason: 'history_frequent',
          score: expectedC,
          nameSim: 1,
          foodMasterId: 'fm_freq_c',
          compositionCode: null,
          name: 'soup_c',
          isEstimated: false,
          matchedQueries: ['soup'],
        },
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_freq_d',
          compositionCode: null,
          name: 'soup_d',
          isEstimated: false,
          matchedQueries: ['soup'],
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
      const result = (
        await matcher.search({ queries: ['bread'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_fuzz',
          compositionCode: null,
          name: 'bread_e',
          isEstimated: false,
          matchedQueries: ['bread'],
        },
      ])
    })

    it('falls back to the composition table when no food_master matches', async () => {
      const tx = getTx()
      await seedFoodComposition(tx, { code: 'comp_noodle', name: 'noodle' })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['noodle'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'composition_table',
          score: 1,
          nameSim: 1,
          foodMasterId: null,
          compositionCode: 'comp_noodle',
          name: 'noodle',
          isEstimated: true,
          matchedQueries: ['noodle'],
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
      const result = (
        await matcher.search({ queries: ['curry'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_curry',
          compositionCode: null,
          name: 'curry_f',
          isEstimated: false,
          matchedQueries: ['curry'],
        },
      ])
    })

    it('returns an empty array when nothing matches any query', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_other',
        name: 'pasta_g',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['tofu'], limit: 5 })
      )._unsafeUnwrap()

      expect(result).toEqual([])
    })
  })

  describe('multi-query batches', () => {
    it('merges two queries that each match the same food (one via name, one via alias) into a single candidate', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_merge_h',
        name: 'cereal_h',
        source: 'user_input',
      })
      await seedFoodMasterAlias(tx, {
        id: 'alias_merge_i',
        foodMasterId: 'fm_merge_h',
        alias: 'grain_alias_i',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['cereal', 'grain_alias'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_merge_h',
          compositionCode: null,
          name: 'cereal_h',
          isEstimated: false,
          matchedQueries: ['cereal', 'grain_alias'],
        },
      ])
    })
  })

  describe('regression: short/padded queries against a long registered name', () => {
    it('finds a food_master by its bare brand name alone even though the registered name is much longer (regression: a short brand query scored below threshold against a long multi-word name)', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_brand_genki',
        name: 'ゲンキ ウェイトダウン チョコレート',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['ゲンキ'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_brand_genki',
          compositionCode: null,
          name: 'ゲンキ ウェイトダウン チョコレート',
          isEstimated: false,
          matchedQueries: ['ゲンキ'],
        },
      ])
    })

    it('still returns the match, with a strong score, when the query is padded with an extra word the registered name does not contain', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_brand_padded_j',
        name: 'protein_bar_j',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({
          queries: ['protein_bar extra'],
          limit: 5,
        })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 0.667,
          nameSim: 0.667,
          foodMasterId: 'fm_brand_padded_j',
          compositionCode: null,
          name: 'protein_bar_j',
          isEstimated: false,
          matchedQueries: ['protein_bar extra'],
        },
      ])
    })

    it('finds a query substring embedded in the middle of a name with no surrounding word boundary', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_compound_k',
        name: 'newgrainmix',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['grain'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 0.5,
          nameSim: 0.5,
          foodMasterId: 'fm_compound_k',
          compositionCode: null,
          name: 'newgrainmix',
          isEstimated: false,
          matchedQueries: ['grain'],
        },
      ])
    })
  })

  describe('multi-byte (Japanese) name matches', () => {
    // pg_trgm delegates "is this a word character" to libc's iswalpha(),
    // which is locale-dependent: under a `C`/`POSIX` ctype locale every
    // non-ASCII byte is rejected, so no trigrams are generated for Japanese
    // text and similarity() returns 0 even for identical strings. These
    // tests only pass when Postgres is initdb'd with a UTF-8-aware ctype
    // locale (e.g. `C.UTF-8`), not bare `C`.
    it('matches a food_master by an identical Japanese name', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_ja_name',
        name: '味噌汁',
        source: 'user_input',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['味噌汁'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_ja_name',
          compositionCode: null,
          name: '味噌汁',
          isEstimated: false,
          matchedQueries: ['味噌汁'],
        },
      ])
    })

    it('matches a food_master via food_master_aliases by an identical Japanese alias', async () => {
      const tx = getTx()
      await seedFoodMaster(tx, {
        id: 'fm_ja_alias',
        name: '木綿豆腐',
        source: 'user_input',
      })
      await seedFoodMasterAlias(tx, {
        id: 'alias_ja_1',
        foodMasterId: 'fm_ja_alias',
        alias: '絹ごし豆腐',
      })

      const matcher = createDrizzleFoodMatcher(tx)
      const result = (
        await matcher.search({ queries: ['絹ごし豆腐'], limit: 5 })
      )._unsafeUnwrap()

      expect(normalize(result)).toEqual([
        {
          reason: 'fuzzy_name',
          score: 1,
          nameSim: 1,
          foodMasterId: 'fm_ja_alias',
          compositionCode: null,
          name: '木綿豆腐',
          isEstimated: false,
          matchedQueries: ['絹ごし豆腐'],
        },
      ])
    })
  })
})
