import type { Result } from 'neverthrow'
import { expect, it } from 'vitest'

import { createDrizzleMealSetRepository } from '#domain/meal-set/drizzle-meal-set-repository'
import type { MealSetDomainError } from '#domain/meal-set/errors'
import { createMealSetService } from '#domain/meal-set/meal-set-service'
import type { MealSet } from '#domain/meal-set/types'
import { describeIfDb, setupDrizzleTx } from '#test/db'
import { seedFoodMasterWithoutNutrition } from '#test/seed'

const CREATED_AT_PLACEHOLDER = new Date('2000-01-01T00:00:00.000Z')

const normalizeMealSet = (mealSet: MealSet): MealSet => ({
  ...mealSet,
  createdAt: CREATED_AT_PLACEHOLDER,
})

const observation = <T extends object>(value: T): T => value

const errorShape = <Value>(
  result: Result<Value, MealSetDomainError>,
): { code: string; details: Readonly<Record<string, unknown>> } | null =>
  result.isErr()
    ? { code: result.error.code, details: result.error.details }
    : null

describeIfDb('MealSetService with DrizzleMealSetRepository', () => {
  const getTx = setupDrizzleTx()

  const buildService = () => {
    let nextId = 0
    const repository = createDrizzleMealSetRepository(getTx(), {
      wrapInTransaction: false,
    })
    return createMealSetService({
      repository,
      idGenerator: () => `ms_domain_test_${String(++nextId)}`,
    })
  }

  const seedFoods = async () => {
    const tx = getTx()
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_set_alpha',
      name: 'alpha sample food',
    })
    await seedFoodMasterWithoutNutrition(tx, {
      id: 'fm_meal_set_zeta',
      name: 'zeta sample food',
    })
  }

  it('registers a meal set with normalized name and food names ordered by name', async () => {
    await seedFoods()
    const service = buildService()

    const created = await service.register({
      name: '  sample blend  ',
      items: [
        { foodMasterId: 'fm_meal_set_zeta', quantity: 1.5 },
        { foodMasterId: 'fm_meal_set_alpha', quantity: 2 },
      ],
    })

    expect(normalizeMealSet(created._unsafeUnwrap())).toEqual({
      id: 'ms_domain_test_1',
      name: 'sample blend',
      items: [
        {
          foodMasterId: 'fm_meal_set_alpha',
          foodName: 'alpha sample food',
          quantity: 2,
        },
        {
          foodMasterId: 'fm_meal_set_zeta',
          foodName: 'zeta sample food',
          quantity: 1.5,
        },
      ],
      createdAt: CREATED_AT_PLACEHOLDER,
    })
  })

  it('lists sets by name and gets a set by ID with its food names', async () => {
    await seedFoods()
    const service = buildService()
    const morning = await service.register({
      name: 'morning blend',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 1 }],
    })
    const evening = await service.register({
      name: 'evening blend',
      items: [{ foodMasterId: 'fm_meal_set_zeta', quantity: 2 }],
    })

    const [listed, found] = await Promise.all([
      service.list(),
      service.getById(morning._unsafeUnwrap().id),
    ])
    const foundSet = found._unsafeUnwrap()

    expect(
      observation({
        list: listed._unsafeUnwrap().map(normalizeMealSet),
        found: foundSet === null ? null : normalizeMealSet(foundSet),
        registeredEveningId: evening._unsafeUnwrap().id,
      }),
    ).toEqual({
      list: [
        {
          id: 'ms_domain_test_2',
          name: 'evening blend',
          items: [
            {
              foodMasterId: 'fm_meal_set_zeta',
              foodName: 'zeta sample food',
              quantity: 2,
            },
          ],
          createdAt: CREATED_AT_PLACEHOLDER,
        },
        {
          id: 'ms_domain_test_1',
          name: 'morning blend',
          items: [
            {
              foodMasterId: 'fm_meal_set_alpha',
              foodName: 'alpha sample food',
              quantity: 1,
            },
          ],
          createdAt: CREATED_AT_PLACEHOLDER,
        },
      ],
      found: {
        id: 'ms_domain_test_1',
        name: 'morning blend',
        items: [
          {
            foodMasterId: 'fm_meal_set_alpha',
            foodName: 'alpha sample food',
            quantity: 1,
          },
        ],
        createdAt: CREATED_AT_PLACEHOLDER,
      },
      registeredEveningId: 'ms_domain_test_2',
    })
  })

  it('replaces the name and items when updating a set', async () => {
    await seedFoods()
    const service = buildService()
    const created = await service.register({
      name: 'original blend',
      items: [{ foodMasterId: 'fm_meal_set_zeta', quantity: 1 }],
    })

    const updated = await service.update({
      id: created._unsafeUnwrap().id,
      name: '  revised blend ',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 3 }],
    })

    expect(normalizeMealSet(updated._unsafeUnwrap())).toEqual({
      id: 'ms_domain_test_1',
      name: 'revised blend',
      items: [
        {
          foodMasterId: 'fm_meal_set_alpha',
          foodName: 'alpha sample food',
          quantity: 3,
        },
      ],
      createdAt: CREATED_AT_PLACEHOLDER,
    })
  })

  it('deletes a set and returns null when it is fetched afterward', async () => {
    await seedFoods()
    const service = buildService()
    const created = await service.register({
      name: 'removable blend',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 1 }],
    })

    const deleted = await service.delete(created._unsafeUnwrap().id)
    const found = await service.getById(created._unsafeUnwrap().id)
    expect(
      observation({
        deleted: deleted.isOk(),
        found: found._unsafeUnwrap(),
      }),
    ).toEqual({ deleted: true, found: null })
  })

  it('finds a meal set by a slightly misspelled name', async () => {
    await seedFoods()
    const service = buildService()
    await service.register({
      name: 'amber grain blend',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 1 }],
    })
    await service.register({
      name: 'cobalt grain mix',
      items: [{ foodMasterId: 'fm_meal_set_zeta', quantity: 1 }],
    })

    const found = await service.searchByName('amber grain blen')

    expect(found._unsafeUnwrap().map(normalizeMealSet)).toEqual([
      {
        id: 'ms_domain_test_1',
        name: 'amber grain blend',
        items: [
          {
            foodMasterId: 'fm_meal_set_alpha',
            foodName: 'alpha sample food',
            quantity: 1,
          },
        ],
        createdAt: CREATED_AT_PLACEHOLDER,
      },
    ])
  })

  it('returns an empty name domain error for a blank name', async () => {
    const result = await buildService().register({
      name: '   ',
      items: [{ foodMasterId: 'fm_missing', quantity: 1 }],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/empty_name',
      details: {},
    })
  })

  it('returns an empty items domain error when registering no items', async () => {
    const result = await buildService().register({
      name: 'sample blend',
      items: [],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/empty_items',
      details: {},
    })
  })

  it('returns a duplicate food master domain error for repeated IDs', async () => {
    const result = await buildService().register({
      name: 'sample blend',
      items: [
        { foodMasterId: 'fm_sample', quantity: 1 },
        { foodMasterId: 'fm_sample', quantity: 2 },
      ],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/duplicate_food_master',
      details: { foodMasterId: 'fm_sample' },
    })
  })

  it('returns an invalid quantity domain error for a zero quantity', async () => {
    const result = await buildService().register({
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_sample', quantity: 0 }],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/invalid_quantity',
      details: { foodMasterId: 'fm_sample', quantity: 0 },
    })
  })

  it('returns an invalid quantity domain error for a negative quantity', async () => {
    const result = await buildService().register({
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_sample', quantity: -1 }],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/invalid_quantity',
      details: { foodMasterId: 'fm_sample', quantity: -1 },
    })
  })

  it('returns a food master not found domain error for an unknown ID', async () => {
    const result = await buildService().register({
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_missing', quantity: 1 }],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/food_master_not_found',
      details: { foodMasterId: 'fm_missing' },
    })
  })

  it('returns a duplicate name domain error for an existing name', async () => {
    await seedFoods()
    const service = buildService()
    await service.register({
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 1 }],
    })

    const duplicate = await service.register({
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_meal_set_zeta', quantity: 1 }],
    })

    expect(errorShape(duplicate)).toEqual({
      code: 'meal_set/duplicate_name',
      details: { name: 'sample blend' },
    })
  })

  it('returns a not found domain error when updating an unknown ID', async () => {
    await seedFoods()
    const result = await buildService().update({
      id: 'ms_missing',
      name: 'sample blend',
      items: [{ foodMasterId: 'fm_meal_set_alpha', quantity: 1 }],
    })

    expect(errorShape(result)).toEqual({
      code: 'meal_set/not_found',
      details: { id: 'ms_missing' },
    })
  })
})
