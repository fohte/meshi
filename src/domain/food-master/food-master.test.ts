import { beforeEach, expect, it } from 'vitest'

import {
  createFoodMasterRepository,
  createFoodMasterService,
  type FoodMasterService,
  type RegisterFoodMasterInput,
} from '#domain/food-master/index'
import type { RegisteredFromComposition } from '#domain/food-master/service'
import { captureDomainError } from '#test/capture-domain-error'
import { describeIfDb, setupTx } from '#test/db'
import { createCountingIdGenerator, type IdCounter } from '#test/id-counter'
import { seedFoodComposition } from '#test/seed'

const baseInput: RegisterFoodMasterInput = {
  name: 'rice',
  nutrition: { energy_kcal: 168, protein_g: 2.5 },
  source: 'user_input',
  isEstimated: false,
}

describeIfDb('FoodMasterService + Repository', () => {
  const getTx = setupTx()
  let service: FoodMasterService

  beforeEach(async () => {
    const tx = getTx()
    await tx`
      INSERT INTO nutrient_definitions (code, display_name, unit, is_major, sort_order)
      VALUES
        ('energy_kcal', 'energy', 'kcal', true, 0),
        ('protein_g', 'protein', 'g', true, 1),
        ('iron_mg', 'iron', 'mg', false, 2)
    `
    let n = 0
    const idCounter: IdCounter = {
      next: () => {
        n += 1
        return n
      },
    }
    const repo = createFoodMasterRepository(tx, {
      generateId: createCountingIdGenerator(idCounter),
      // The outer per-test transaction already provides atomicity, and
      // postgres-js rejects a nested BEGIN inside it.
      wrapInTransaction: false,
    })
    service = createFoodMasterService(repo)
  })

  const normalize = <T extends { createdAt: Date }>(
    fm: T,
  ): Omit<T, 'createdAt'> & { createdAt: '<date>' } => ({
    ...fm,
    createdAt: '<date>',
  })

  // Combines both fields of a registerFromComposition() result into one
  // object so the two tests below can assert on it with a single toEqual
  // instead of two separate expect() calls.
  const normalizeRegistered = (
    registered: RegisteredFromComposition,
  ): {
    foodMaster: ReturnType<
      typeof normalize<RegisteredFromComposition['foodMaster']>
    >
    compositionName: string
  } => ({
    foodMaster: normalize(registered.foodMaster),
    compositionName: registered.compositionName,
  })

  // word_similarity() scores carry more float precision than is worth
  // pinning in a test; round to 2 decimal places so the expected value can
  // still be a plain literal.
  const normalizeScores = <T extends { score: number }>(
    candidates: ReadonlyArray<T>,
  ): ReadonlyArray<Omit<T, 'score'> & { score: number }> =>
    candidates.map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }))

  it('registers a confirmed food master and round-trips it through getById', async () => {
    const registered = (
      await service.register({
        name: 'rice',
        aliases: ['ご飯', 'cooked rice'],
        nutrition: { energy_kcal: 168, protein_g: 2.5, iron_mg: 0.1 },
        source: 'web_search',
        isEstimated: false,
        sourceUrl: 'https://example.com/rice',
      })
    )._unsafeUnwrap()

    expect(normalize(registered)).toEqual({
      id: 'fm_test_0001',
      name: 'rice',
      aliases: ['ご飯', 'cooked rice'],
      isEstimated: false,
      source: 'web_search',
      sourceUrl: 'https://example.com/rice',
      sourceCompositionCode: null,
      nutrition: { energy_kcal: 168, protein_g: 2.5, iron_mg: 0.1 },
      createdAt: '<date>',
    })

    const fetched = (await service.getById('fm_test_0001'))._unsafeUnwrap()
    expect(fetched === null ? null : normalize(fetched)).toEqual(
      normalize(registered),
    )
  })

  it("rejects is_estimated=true combined with source='web_search'", async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'guess from web',
        source: 'web_search',
        isEstimated: true,
        sourceUrl: 'https://example.com/guess',
      }),
    )

    expect(captured).toEqual({
      code: 'invalid_source_combination',
      details: { source: 'web_search', isEstimated: true },
    })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '0' }])
  })

  it("rejects is_estimated=false combined with source='composition_table_estimate'", async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'homemade curry',
        source: 'composition_table_estimate',
        isEstimated: false,
        sourceCompositionCode: '18008',
      }),
    )

    expect(captured).toEqual({
      code: 'invalid_source_combination',
      details: { source: 'composition_table_estimate', isEstimated: false },
    })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '0' }])
  })

  it("rejects source='web_search' without source_url", async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({
        name: 'milk',
        nutrition: { energy_kcal: 67 },
        source: 'web_search',
        isEstimated: false,
      }),
    )

    expect(captured).toEqual({
      code: 'missing_source_url',
      details: {
        source: 'web_search',
        sourceUrl: null,
        sourceCompositionCode: null,
      },
    })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '0' }])
  })

  it("registers source='web_search' with source_url and round-trips sourceCompositionCode as null", async () => {
    const registered = (
      await service.register({
        name: 'milk',
        nutrition: { energy_kcal: 67 },
        source: 'web_search',
        isEstimated: false,
        sourceUrl: 'https://example.com/milk',
      })
    )._unsafeUnwrap()

    expect(normalize(registered)).toEqual({
      id: 'fm_test_0001',
      name: 'milk',
      aliases: [],
      isEstimated: false,
      source: 'web_search',
      sourceUrl: 'https://example.com/milk',
      sourceCompositionCode: null,
      nutrition: { energy_kcal: 67 },
      createdAt: '<date>',
    })
  })

  it("rejects source='composition_table_estimate' without sourceCompositionCode", async () => {
    const captured = await captureDomainError(
      service.register({
        name: 'homemade curry',
        nutrition: { energy_kcal: 250 },
        source: 'composition_table_estimate',
        isEstimated: true,
      }),
    )

    expect(captured).toEqual({
      code: 'missing_composition_code',
      details: {
        source: 'composition_table_estimate',
        sourceUrl: null,
        sourceCompositionCode: null,
      },
    })
  })

  it("rejects sourceUrl set with source='composition_table_estimate'", async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '18008', name: 'カレールウ' })
    const captured = await captureDomainError(
      service.register({
        name: 'homemade curry',
        nutrition: { energy_kcal: 250 },
        source: 'composition_table_estimate',
        isEstimated: true,
        sourceUrl: 'https://example.com/curry',
        sourceCompositionCode: '18008',
      }),
    )

    expect(captured).toEqual({
      code: 'unexpected_source_url',
      details: {
        source: 'composition_table_estimate',
        sourceUrl: 'https://example.com/curry',
        sourceCompositionCode: '18008',
      },
    })
  })

  it("rejects sourceCompositionCode set with source='user_input'", async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '18008', name: 'カレールウ' })
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'homemade curry',
        sourceCompositionCode: '18008',
      }),
    )

    expect(captured).toEqual({
      code: 'unexpected_composition_code',
      details: {
        source: 'user_input',
        sourceUrl: null,
        sourceCompositionCode: '18008',
      },
    })
  })

  it("rejects sourceCompositionCode set with source='web_search'", async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '18008', name: 'カレールウ' })
    const captured = await captureDomainError(
      service.register({
        name: 'homemade curry',
        nutrition: { energy_kcal: 250 },
        source: 'web_search',
        isEstimated: false,
        sourceUrl: 'https://example.com/curry',
        sourceCompositionCode: '18008',
      }),
    )

    expect(captured).toEqual({
      code: 'unexpected_composition_code',
      details: {
        source: 'web_search',
        sourceUrl: 'https://example.com/curry',
        sourceCompositionCode: '18008',
      },
    })
  })

  it("rejects sourceUrl set with source='user_input'", async () => {
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'homemade curry',
        sourceUrl: 'https://example.com/curry',
      }),
    )

    expect(captured).toEqual({
      code: 'unexpected_source_url',
      details: {
        source: 'user_input',
        sourceUrl: 'https://example.com/curry',
        sourceCompositionCode: null,
      },
    })
  })

  it("registers source='composition_table_estimate' with sourceCompositionCode and round-trips it", async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '18008', name: 'カレールウ' })
    const registered = (
      await service.register({
        name: 'homemade curry',
        nutrition: { energy_kcal: 250 },
        source: 'composition_table_estimate',
        isEstimated: true,
        sourceCompositionCode: '18008',
      })
    )._unsafeUnwrap()

    expect(normalize(registered)).toEqual({
      id: 'fm_test_0001',
      name: 'homemade curry',
      aliases: [],
      isEstimated: true,
      source: 'composition_table_estimate',
      sourceUrl: null,
      sourceCompositionCode: '18008',
      nutrition: { energy_kcal: 250 },
      createdAt: '<date>',
    })

    const fetched = (await service.getById('fm_test_0001'))._unsafeUnwrap()
    expect(fetched === null ? null : normalize(fetched)).toEqual(
      normalize(registered),
    )
  })

  it('rejects registrations with nutrient_code not present in nutrient_definitions', async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'mystery food',
        nutrition: { energy_kcal: 100, mystery_nutrient_g: 5 },
      }),
    )

    expect(captured).toEqual({
      code: 'unknown_nutrient_code',
      details: { unknown: ['mystery_nutrient_g'] },
    })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '0' }])
  })

  it('rejects duplicate name registration', async () => {
    const tx = getTx()
    ;(await service.register(baseInput))._unsafeUnwrap()
    const captured = await captureDomainError(
      service.register({ ...baseInput, nutrition: { energy_kcal: 200 } }),
    )

    expect(captured).toEqual({
      code: 'duplicate_name',
      details: { name: baseInput.name },
    })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '1' }])
  })

  it('rejects empty name', async () => {
    const captured = await captureDomainError(
      service.register({ ...baseInput, name: '   ' }),
    )

    expect(captured).toEqual({ code: 'empty_name', details: {} })
  })

  it('rejects empty nutrition', async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({ ...baseInput, name: 'no-nutrition', nutrition: {} }),
    )

    expect(captured).toEqual({ code: 'empty_nutrition', details: {} })

    const rows = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM food_masters
    `
    expect(rows).toEqual([{ count: '0' }])
  })

  it('rejects negative nutrient values', async () => {
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'broken',
        nutrition: { energy_kcal: -1 },
      }),
    )

    expect(captured).toEqual({
      code: 'negative_nutrient_value',
      details: { code: 'energy_kcal', value: -1 },
    })
  })

  it('rejects non-finite nutrient values', async () => {
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'broken-inf',
        nutrition: { energy_kcal: Number.POSITIVE_INFINITY },
      }),
    )

    expect(captured).toEqual({
      code: 'negative_nutrient_value',
      details: { code: 'energy_kcal', value: Number.POSITIVE_INFINITY },
    })
  })

  it('rejects duplicate aliases within the same input before hitting the DB', async () => {
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'apple',
        aliases: ['りんご', 'りんご'],
      }),
    )

    expect(captured).toEqual({
      code: 'duplicate_alias_in_input',
      details: { aliases: ['りんご', 'りんご'] },
    })
  })

  it('rejects empty alias strings', async () => {
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'apple',
        aliases: ['ok', ''],
      }),
    )

    expect(captured).toEqual({ code: 'empty_alias', details: {} })
  })

  it('distinguishes alias-UNIQUE collision from name collision', async () => {
    ;(
      await service.register({
        name: 'apple',
        nutrition: { energy_kcal: 50 },
        source: 'user_input',
        isEstimated: false,
        aliases: ['りんご'],
      })
    )._unsafeUnwrap()

    const captured = await captureDomainError(
      service.register({
        name: 'red apple',
        nutrition: { energy_kcal: 52 },
        source: 'user_input',
        isEstimated: false,
        aliases: ['りんご'],
      }),
    )

    expect(captured).toEqual({
      code: 'duplicate_alias',
      details: { aliases: ['りんご'] },
    })
  })

  it('returns null for unknown id', async () => {
    expect(
      (await service.getById('fm_does_not_exist'))._unsafeUnwrap(),
    ).toEqual(null)
  })

  it('registers a food_master from a food_compositions row', async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '01088', name: 'そば ゆで' })
    await tx`
      INSERT INTO food_composition_nutrients (food_composition_code, nutrient_code, value)
      VALUES ('01088', 'energy_kcal', '130'), ('01088', 'protein_g', '4.8')
    `

    const registered = (
      await service.registerFromComposition({ compositionCode: '01088' })
    )._unsafeUnwrap()

    expect(normalizeRegistered(registered)).toEqual({
      foodMaster: {
        id: 'fm_test_0001',
        name: 'そば ゆで',
        aliases: [],
        isEstimated: true,
        source: 'composition_table_estimate',
        sourceUrl: null,
        sourceCompositionCode: '01088',
        nutrition: { energy_kcal: 130, protein_g: 4.8 },
        createdAt: '<date>',
      },
      compositionName: 'そば ゆで',
    })

    const fetched = (await service.getById('fm_test_0001'))._unsafeUnwrap()
    expect(fetched === null ? null : normalize(fetched)).toEqual(
      normalize(registered.foodMaster),
    )
  })

  it('overrides the composition name while nutrition still comes from the composition row', async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '01088', name: 'そば ゆで' })
    await tx`
      INSERT INTO food_composition_nutrients (food_composition_code, nutrient_code, value)
      VALUES ('01088', 'energy_kcal', '130'), ('01088', 'protein_g', '4.8')
    `

    const registered = (
      await service.registerFromComposition({
        compositionCode: '01088',
        name: 'カスタム名',
        aliases: ['そば'],
      })
    )._unsafeUnwrap()

    expect(normalizeRegistered(registered)).toEqual({
      foodMaster: {
        id: 'fm_test_0001',
        name: 'カスタム名',
        aliases: ['そば'],
        isEstimated: true,
        source: 'composition_table_estimate',
        sourceUrl: null,
        sourceCompositionCode: '01088',
        nutrition: { energy_kcal: 130, protein_g: 4.8 },
        createdAt: '<date>',
      },
      compositionName: 'そば ゆで',
    })
  })

  it('rejects registerFromComposition for an unknown composition code', async () => {
    const captured = await captureDomainError(
      service.registerFromComposition({ compositionCode: '99999' }),
    )

    expect(captured).toEqual({
      code: 'composition_not_found',
      details: { compositionCode: '99999' },
    })
  })

  it('rejects registerFromComposition when the name already exists', async () => {
    const tx = getTx()
    await seedFoodComposition(tx, { code: '01088', name: baseInput.name })
    await tx`
      INSERT INTO food_composition_nutrients (food_composition_code, nutrient_code, value)
      VALUES ('01088', 'energy_kcal', '130')
    `
    ;(await service.register(baseInput))._unsafeUnwrap()

    const captured = await captureDomainError(
      service.registerFromComposition({ compositionCode: '01088' }),
    )

    expect(captured).toEqual({
      code: 'duplicate_name',
      details: { name: baseInput.name },
    })
  })

  it('finds an existing food_master whose name is a plausible near-duplicate, scored above the threshold', async () => {
    ;(
      await service.register({
        ...baseInput,
        name: 'ごろごろ野菜カレー 中辛',
      })
    )._unsafeUnwrap()

    const result = (
      await service.findSimilarNames('ごろごろ野菜カレー（レトルト）')
    )._unsafeUnwrap()

    expect(normalizeScores(result)).toEqual([
      {
        foodMasterId: 'fm_test_0001',
        name: 'ごろごろ野菜カレー 中辛',
        score: 0.77,
      },
    ])
  })

  it('excludes an exact name match from findSimilarNames results', async () => {
    ;(
      await service.register({
        ...baseInput,
        name: 'ごろごろ野菜カレー 中辛',
      })
    )._unsafeUnwrap()

    const result = (
      await service.findSimilarNames('ごろごろ野菜カレー 中辛')
    )._unsafeUnwrap()

    expect(result).toEqual([])
  })

  it('returns no candidates when nothing registered scores above the threshold', async () => {
    ;(await service.register({ ...baseInput, name: 'バナナ' }))._unsafeUnwrap()

    const result = (await service.findSimilarNames('ラーメン'))._unsafeUnwrap()

    expect(result).toEqual([])
  })

  it('orders findSimilarNames results by score, highest first', async () => {
    ;(
      await service.register({
        ...baseInput,
        name: 'ごろごろ野菜カレー 中辛',
      })
    )._unsafeUnwrap()
    ;(
      await service.register({
        ...baseInput,
        name: 'ごろごろ野菜カレーパン 中辛',
      })
    )._unsafeUnwrap()

    const result = (
      await service.findSimilarNames('ごろごろ野菜カレー（レトルト）')
    )._unsafeUnwrap()

    expect(normalizeScores(result)).toEqual([
      {
        foodMasterId: 'fm_test_0001',
        name: 'ごろごろ野菜カレー 中辛',
        score: 0.77,
      },
      {
        foodMasterId: 'fm_test_0003',
        name: 'ごろごろ野菜カレーパン 中辛',
        score: 0.6,
      },
    ])
  })

  it('adds an alias to an existing food_master, visible through getById', async () => {
    await service.register(baseInput)

    const added = await service.addAlias('fm_test_0001', 'ご飯')

    expect(added.isOk()).toBe(true)
    const fetched = (await service.getById('fm_test_0001'))._unsafeUnwrap()
    expect(fetched === null ? null : normalize(fetched)).toEqual({
      id: 'fm_test_0001',
      name: 'rice',
      aliases: ['ご飯'],
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      nutrition: baseInput.nutrition,
      createdAt: '<date>',
    })
  })

  it('does not error, and does not move the alias, when it already belongs to another food_master', async () => {
    const rice = (
      await service.register({ ...baseInput, name: 'rice', aliases: ['ご飯'] })
    )._unsafeUnwrap()
    const friedRice = (
      await service.register({ ...baseInput, name: 'fried rice' })
    )._unsafeUnwrap()

    const added = await service.addAlias(friedRice.id, 'ご飯')

    expect(added.isOk()).toBe(true)
    const owner = (await service.getById(rice.id))._unsafeUnwrap()
    const other = (await service.getById(friedRice.id))._unsafeUnwrap()
    expect(owner === null ? null : normalize(owner)).toEqual({
      id: rice.id,
      name: 'rice',
      aliases: ['ご飯'],
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      nutrition: baseInput.nutrition,
      createdAt: '<date>',
    })
    expect(other === null ? null : normalize(other)).toEqual({
      id: friedRice.id,
      name: 'fried rice',
      aliases: [],
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      sourceCompositionCode: null,
      nutrition: baseInput.nutrition,
      createdAt: '<date>',
    })
  })
})
