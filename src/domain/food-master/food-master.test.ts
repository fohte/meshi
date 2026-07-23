import type { ResultAsync } from 'neverthrow'
import { beforeEach, expect, it } from 'vitest'

import {
  createFoodMasterRepository,
  createFoodMasterService,
  type FoodMasterDomainError,
  type FoodMasterService,
  type RegisterFoodMasterInput,
} from '@/domain/food-master'
import { describeIfDb, setupTx } from '@/test/db'

interface IdCounter {
  next(): number
}

const createCountingIdGenerator = (
  counter: IdCounter,
): ((prefix: string) => string) => {
  return (prefix) => `${prefix}_test_${String(counter.next()).padStart(4, '0')}`
}

const captureDomainError = async (
  resultAsync: ResultAsync<unknown, FoodMasterDomainError>,
): Promise<{ code: string; details: Readonly<Record<string, unknown>> }> => {
  const result = await resultAsync
  if (result.isOk()) {
    throw new Error('expected FoodMasterDomainError but got Ok')
  }
  return { code: result.error.code, details: result.error.details }
}

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
      nutrition: { energy_kcal: 168, protein_g: 2.5, iron_mg: 0.1 },
      createdAt: '<date>',
    })

    const fetched = (await service.getById('fm_test_0001'))._unsafeUnwrap()
    expect(fetched === null ? null : normalize(fetched)).toEqual(
      normalize(registered),
    )
  })

  it('accepts an estimated food master backed by the composition table', async () => {
    const registered = (
      await service.register({
        name: 'homemade curry',
        nutrition: { energy_kcal: 250 },
        source: 'composition_table_estimate',
        isEstimated: true,
      })
    )._unsafeUnwrap()

    expect(normalize(registered)).toEqual({
      id: 'fm_test_0001',
      name: 'homemade curry',
      aliases: [],
      isEstimated: true,
      source: 'composition_table_estimate',
      sourceUrl: null,
      nutrition: { energy_kcal: 250 },
      createdAt: '<date>',
    })
  })

  it("rejects is_estimated=true combined with source='web_search'", async () => {
    const tx = getTx()
    const captured = await captureDomainError(
      service.register({
        ...baseInput,
        name: 'guess from web',
        source: 'web_search',
        isEstimated: true,
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

  it("allows source='web_search' without source_url (recommendation only)", async () => {
    const registered = (
      await service.register({
        name: 'milk',
        nutrition: { energy_kcal: 67 },
        source: 'web_search',
        isEstimated: false,
      })
    )._unsafeUnwrap()

    expect(normalize(registered)).toEqual({
      id: 'fm_test_0001',
      name: 'milk',
      aliases: [],
      isEstimated: false,
      source: 'web_search',
      sourceUrl: null,
      nutrition: { energy_kcal: 67 },
      createdAt: '<date>',
    })
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
})
