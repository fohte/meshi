import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import {
  DomainError,
  FoodMasterNotFoundError,
  FoodNameMismatchError,
  FutureEatenDateError,
  ImplausibleQuantityError,
  InvalidQuantityError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
  UpdateMealLogPatch,
} from '#domain/meal-log/meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type { FoodMasterRef, MealLogRow } from '#domain/meal-log/types'
import { jstDate } from '#test/jst-date'

const NOW = new Date('2026-06-16T12:00:00.000Z')
const CREATED_AT = new Date('2026-06-16T12:00:00.500Z')
// JST calendar date of NOW — deps.now() returns NOW, so this doubles as
// "today" for the future-date boundary tests below.
const EATEN_DATE = jstDate('2026-06-16')

interface FakeRepoOptions {
  readonly foodMasters: ReadonlyArray<FoodMasterRef>
  readonly existingLogs?: ReadonlyArray<FoundMealLog>
}

const createFakeRepository = (
  options: FakeRepoOptions,
): {
  repository: MealLogRepository
  inserted: InsertMealLogInput[]
  updated: UpdateMealLogPatch[]
} => {
  const foodMasterById = new Map(options.foodMasters.map((f) => [f.id, f]))
  const logs = new Map(
    (options.existingLogs ?? []).map((found) => [found.log.id, found]),
  )
  const inserted: InsertMealLogInput[] = []
  const updated: UpdateMealLogPatch[] = []
  const repository: MealLogRepository = {
    findFoodMaster: (id) => {
      const food = foodMasterById.get(id)
      if (food === undefined) {
        return errAsync(new FoodMasterNotFoundError(id))
      }
      return okAsync(food)
    },
    insertMealLog: (input) => {
      inserted.push(input)
      const row: MealLogRow = {
        id: input.id,
        foodMasterId: input.foodMasterId,
        eatenDate: input.eatenDate,
        mealType: input.mealType,
        quantity: input.quantity,
        createdAt: CREATED_AT,
      }
      return okAsync(row)
    },
    updateMealLog: (input) => {
      updated.push(input)
      const existing = logs.get(input.id)
      if (existing === undefined) {
        return errAsync(
          new DomainError('meal_logs update returned no rows', 'test/unused'),
        )
      }
      const merged: MealLogRow = {
        ...existing.log,
        ...(input.foodMasterId === undefined
          ? {}
          : { foodMasterId: input.foodMasterId }),
        ...(input.eatenDate === undefined
          ? {}
          : { eatenDate: input.eatenDate }),
        ...(input.mealType === undefined ? {} : { mealType: input.mealType }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
      }
      logs.set(input.id, { log: merged, food: existing.food })
      return okAsync(merged)
    },
    findMealLogById: (id) => okAsync(logs.get(id) ?? null),
    deleteMealLog: (id) => {
      const existed = logs.delete(id)
      return okAsync(existed)
    },
  }
  return { repository, inserted, updated }
}

interface FakeFoodMasterServiceOptions {
  // A real addAlias never errors on an alias collision (ON CONFLICT DO
  // NOTHING); this simulates the one thing it can still fail on — a genuine
  // persistence error — to prove that surfaces instead of being swallowed.
  readonly failAddAlias?: boolean
}

const createFakeFoodMasterService = (
  options: FakeFoodMasterServiceOptions = {},
): {
  foodMasterService: FoodMasterService
  learnedAliases: Array<{ id: string; alias: string }>
} => {
  const learnedAliases: Array<{ id: string; alias: string }> = []
  const unused = (): never => {
    throw new Error('unused in this test')
  }
  const foodMasterService: FoodMasterService = {
    register: unused,
    getById: unused,
    registerFromComposition: unused,
    findSimilarNames: unused,
    addAlias: (id, alias) => {
      learnedAliases.push({ id, alias })
      return options.failAddAlias === true
        ? errAsync(
            new FoodMasterDomainError('persistence_failed', 'connection lost'),
          )
        : okAsync(undefined)
    },
    merge: unused,
  }
  return { foodMasterService, learnedAliases }
}

const RICE: FoodMasterRef = {
  id: 'fm_rice',
  name: '白米',
  isEstimated: false,
  nutritionPerUnit: {
    energy_kcal: 156,
    protein_g: 2.5,
    fat_g: 0.3,
    carb_g: 37.1,
  },
}

const KARAAGE_GUESS: FoodMasterRef = {
  id: 'fm_karaage',
  name: '唐揚げ',
  isEstimated: true,
  nutritionPerUnit: {
    energy_kcal: 290,
    protein_g: 24.2,
    fat_g: 18.1,
    carb_g: 7.9,
  },
}

const EXISTING_RICE_LOG: FoundMealLog = {
  log: {
    id: 'ml_1',
    foodMasterId: 'fm_rice',
    eatenDate: EATEN_DATE,
    mealType: 'dinner',
    quantity: 1,
    createdAt: CREATED_AT,
  },
  food: RICE,
}

const buildService = (
  foodMasters: ReadonlyArray<FoodMasterRef>,
  existingLogs: ReadonlyArray<FoundMealLog> = [],
  foodMasterServiceOptions: FakeFoodMasterServiceOptions = {},
) => {
  const { repository, inserted, updated } = createFakeRepository({
    foodMasters,
    existingLogs,
  })
  const { foodMasterService, learnedAliases } = createFakeFoodMasterService(
    foodMasterServiceOptions,
  )
  const ids = ['ml_1', 'ml_2', 'ml_3']
  let idx = 0
  const service = createMealLogService({
    repository,
    foodMasterService,
    idGenerator: () => ids[idx++] ?? 'ml_overflow',
    now: () => NOW,
  })
  return { service, inserted, updated, learnedAliases }
}

describe('MealLogService.record', () => {
  it('records a meal and returns nutrition scaled by quantity', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(inserted).toEqual([
      {
        id: 'ml_1',
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      },
    ])
  })

  it('scales nutrition linearly for quantity=2', async () => {
    const { service } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 2,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 2,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 312,
        protein_g: 5,
        fat_g: 0.6,
        carb_g: 74.2,
      },
      isEstimated: false,
    })
  })

  it('propagates is_estimated=true when the underlying food master is estimated', async () => {
    const { service } = buildService([RICE, KARAAGE_GUESS])

    const confirmed = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrap()
    const estimated = (
      await service.record({
        foodMasterId: 'fm_karaage',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrap()

    expect(confirmed).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(estimated).toEqual({
      id: 'ml_2',
      foodMasterId: 'fm_karaage',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 290,
        protein_g: 24.2,
        fat_g: 18.1,
        carb_g: 7.9,
      },
      isEstimated: true,
    })
  })

  it('rejects an eatenDate strictly in the future with FutureEatenDateError', async () => {
    const { service, inserted } = buildService([RICE])
    const future = jstDate('2026-06-17')

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: future,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FutureEatenDateError)
    expect(
      error instanceof FutureEatenDateError ? error.eatenDate : undefined,
    ).toEqual(future)
    expect(inserted).toEqual([])
  })

  it('allows eatenDate exactly equal to today', async () => {
    const { service } = buildService([RICE])
    const today = EATEN_DATE

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: today,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: today,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive / non-finite quantity %p with InvalidQuantityError',
    async (quantity) => {
      const { service, inserted } = buildService([RICE])

      const error = (
        await service.record({
          foodMasterId: 'fm_rice',
          eatenDate: EATEN_DATE,
          mealType: 'dinner',
          quantity,
        })
      )._unsafeUnwrapErr()

      expect(error).toBeInstanceOf(InvalidQuantityError)
      expect(
        error instanceof InvalidQuantityError ? error.quantity : undefined,
      ).toEqual(quantity)
      expect(inserted).toEqual([])
    },
  )

  it('surfaces FoodMasterNotFoundError from the repository when the id is missing', async () => {
    const { service, inserted } = buildService([RICE])

    const error = (
      await service.record({
        foodMasterId: 'fm_missing',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FoodMasterNotFoundError)
    expect(
      error instanceof FoodMasterNotFoundError ? error.foodMasterId : undefined,
    ).toBe('fm_missing')
    expect(inserted).toEqual([])
  })

  it('uses the given mealType verbatim', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'snack',
        quantity: 1,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'snack',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(inserted).toEqual([
      {
        id: 'ml_1',
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'snack',
        quantity: 1,
      },
    ])
  })

  it('rejects a foodName that does not match the resolved food_master with FoodNameMismatchError', async () => {
    const { service, inserted } = buildService([RICE])

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        foodName: '唐揚げ',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FoodNameMismatchError)
    expect(error).toEqual(new FoodNameMismatchError('唐揚げ', '白米'))
    expect(inserted).toEqual([])
  })

  it('accepts a foodName that matches the resolved food_master modulo surrounding whitespace', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        foodName: ' 白米 ',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(inserted).toEqual([
      {
        id: 'ml_1',
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
      },
    ])
  })

  it('rejects a quantity that resolves to an implausible energy_kcal with ImplausibleQuantityError', async () => {
    const { service, inserted } = buildService([RICE])

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 40,
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(ImplausibleQuantityError)
    expect(error).toEqual(new ImplausibleQuantityError(6240))
    expect(inserted).toEqual([])
  })

  it('skips the plausibility check when the food has no energy_kcal value, even for a huge quantity', async () => {
    const WATER: FoodMasterRef = {
      id: 'fm_water',
      name: '水',
      isEstimated: false,
      nutritionPerUnit: { protein_g: 0 },
    }
    const { service, inserted } = buildService([WATER])

    const result = (
      await service.record({
        foodMasterId: 'fm_water',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1_000_000,
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_water',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1_000_000,
      createdAt: CREATED_AT,
      nutrition: { protein_g: 0 },
      isEstimated: false,
    })
    expect(inserted).toEqual([
      {
        id: 'ml_1',
        foodMasterId: 'fm_water',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1_000_000,
      },
    ])
  })
})

describe('MealLogService.update', () => {
  it('returns the current state as a no-op when the patch carries no fields', async () => {
    const { service, updated } = buildService(
      [RICE, KARAAGE_GUESS],
      [EXISTING_RICE_LOG],
    )

    const result = (await service.update({ id: 'ml_1' }))._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([])
  })

  it('updates quantity only, recomputing nutrition and forwarding only the changed field', async () => {
    const { service, updated } = buildService(
      [RICE, KARAAGE_GUESS],
      [EXISTING_RICE_LOG],
    )

    const result = (
      await service.update({ id: 'ml_1', quantity: 2 })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 2,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 312,
        protein_g: 5,
        fat_g: 0.6,
        carb_g: 74.2,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([{ id: 'ml_1', quantity: 2 }])
  })

  it('changes food_master_id and recomputes nutrition against the new food', async () => {
    const { service, updated, learnedAliases } = buildService(
      [RICE, KARAAGE_GUESS],
      [EXISTING_RICE_LOG],
    )

    const result = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_karaage' })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_karaage',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 290,
        protein_g: 24.2,
        fat_g: 18.1,
        carb_g: 7.9,
      },
      isEstimated: true,
    })
    expect(updated).toEqual([{ id: 'ml_1', foodMasterId: 'fm_karaage' }])
    expect(learnedAliases).toEqual([{ id: 'fm_karaage', alias: '白米' }])
  })

  it('fails the update when learning the alias hits a genuine persistence error', async () => {
    const { service, updated, learnedAliases } = buildService(
      [RICE, KARAAGE_GUESS],
      [EXISTING_RICE_LOG],
      { failAddAlias: true },
    )

    const error = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_karaage' })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(MealLogPersistenceError)
    expect(updated).toEqual([{ id: 'ml_1', foodMasterId: 'fm_karaage' }])
    expect(learnedAliases).toEqual([{ id: 'fm_karaage', alias: '白米' }])
  })

  it('does not re-fetch food_master when foodMasterId equals the current value', async () => {
    // RICE is deliberately absent from foodMasters: if the service mistakenly
    // called findFoodMaster for an unchanged id, this would fail with
    // FoodMasterNotFoundError instead of reusing the already-loaded food.
    const { service, updated, learnedAliases } = buildService(
      [],
      [EXISTING_RICE_LOG],
    )

    const result = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_rice' })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([{ id: 'ml_1', foodMasterId: 'fm_rice' }])
    expect(learnedAliases).toEqual([])
  })

  it('rejects a change to a nonexistent food_master_id with FoodMasterNotFoundError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

    const error = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_missing' })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FoodMasterNotFoundError)
    expect(
      error instanceof FoodMasterNotFoundError ? error.foodMasterId : undefined,
    ).toBe('fm_missing')
    expect(updated).toEqual([])
  })

  it('returns MealLogNotFoundError when the meal_log id does not exist', async () => {
    const { service, updated } = buildService([RICE], [])

    const error = (
      await service.update({ id: 'ml_missing', quantity: 1 })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(MealLogNotFoundError)
    expect(error instanceof MealLogNotFoundError ? error.id : undefined).toBe(
      'ml_missing',
    )
    expect(updated).toEqual([])
  })

  it('rejects an eatenDate strictly in the future with FutureEatenDateError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])
    const future = jstDate('2026-06-17')

    const error = (
      await service.update({ id: 'ml_1', eatenDate: future })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FutureEatenDateError)
    expect(
      error instanceof FutureEatenDateError ? error.eatenDate : undefined,
    ).toEqual(future)
    expect(updated).toEqual([])
  })

  it('allows eatenDate exactly equal to today', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])
    const today = EATEN_DATE

    const result = (
      await service.update({ id: 'ml_1', eatenDate: today })
    )._unsafeUnwrap()

    expect(result.eatenDate).toEqual(today)
    expect(updated).toEqual([{ id: 'ml_1', eatenDate: today }])
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive / non-finite quantity %p with InvalidQuantityError',
    async (quantity) => {
      const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

      const error = (
        await service.update({ id: 'ml_1', quantity })
      )._unsafeUnwrapErr()

      expect(error).toBeInstanceOf(InvalidQuantityError)
      expect(
        error instanceof InvalidQuantityError ? error.quantity : undefined,
      ).toEqual(quantity)
      expect(updated).toEqual([])
    },
  )

  it('rejects a quantity update that resolves to an implausible energy_kcal with ImplausibleQuantityError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

    const error = (
      await service.update({ id: 'ml_1', quantity: 40 })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(ImplausibleQuantityError)
    expect(error).toEqual(new ImplausibleQuantityError(6240))
    expect(updated).toEqual([])
  })
})

describe('MealLogService.getById', () => {
  it('returns null when the log does not exist', async () => {
    const { service } = buildService([RICE])
    expect((await service.getById('ml_missing'))._unsafeUnwrap()).toBeNull()
  })

  it('returns a result with nutrition scaled for the stored quantity', async () => {
    const repository: MealLogRepository = {
      findFoodMaster: () => errAsync(new DomainError('unused', 'unused')),
      insertMealLog: () => errAsync(new DomainError('unused', 'unused')),
      updateMealLog: () => errAsync(new DomainError('unused', 'unused')),
      findMealLogById: (id) =>
        okAsync({
          log: {
            id,
            foodMasterId: KARAAGE_GUESS.id,
            eatenDate: jstDate('2026-06-15'),
            mealType: 'lunch',
            quantity: 2,
            createdAt: CREATED_AT,
          },
          food: KARAAGE_GUESS,
        }),
      deleteMealLog: () => errAsync(new DomainError('unused', 'unused')),
    }
    const service = createMealLogService({
      repository,
      foodMasterService: createFakeFoodMasterService().foodMasterService,
      idGenerator: () => 'unused',
      now: () => NOW,
    })

    expect((await service.getById('ml_1'))._unsafeUnwrap()).toEqual({
      id: 'ml_1',
      foodMasterId: KARAAGE_GUESS.id,
      eatenDate: '2026-06-15',
      mealType: 'lunch',
      quantity: 2,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 580,
        protein_g: 48.4,
        fat_g: 36.2,
        carb_g: 15.8,
      },
      isEstimated: true,
    })
  })
})

describe('MealLogService.delete', () => {
  it('deletes an existing log', async () => {
    const { service } = buildService([RICE], [EXISTING_RICE_LOG])
    expect((await service.delete('ml_1')).isOk()).toBe(true)
    expect((await service.getById('ml_1'))._unsafeUnwrap()).toBeNull()
  })

  it('returns a MealLogNotFoundError when the log does not exist', async () => {
    const { service } = buildService([RICE])
    const error = (await service.delete('ml_missing'))._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(MealLogNotFoundError)
    expect(error instanceof MealLogNotFoundError ? error.id : undefined).toBe(
      'ml_missing',
    )
  })
})
