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
  UnknownUnitError,
} from '#domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
  UpdateMealLogPatch,
} from '#domain/meal-log/meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type { FoodMasterRef, MealLogRow } from '#domain/meal-log/types'

const NOW = new Date('2026-06-16T12:00:00.000Z')
const CREATED_AT = new Date('2026-06-16T12:00:00.500Z')
// JST calendar date of NOW — deps.now() returns NOW, so this doubles as
// "today" for the future-date boundary tests below.
const EATEN_DATE = '2026-06-16'

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
        unit: input.unit,
        amountGrams: input.amountGrams,
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
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.amountGrams === undefined
          ? {}
          : { amountGrams: input.amountGrams }),
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
    addAlias: (id, alias) => {
      learnedAliases.push({ id, alias })
      return options.failAddAlias === true
        ? errAsync(
            new FoodMasterDomainError('persistence_failed', 'connection lost'),
          )
        : okAsync(undefined)
    },
  }
  return { foodMasterService, learnedAliases }
}

const RICE: FoodMasterRef = {
  id: 'fm_rice',
  name: '白米',
  isEstimated: false,
  nutritionPerBasis: {
    energy_kcal: 156,
    protein_g: 2.5,
    fat_g: 0.3,
    carb_g: 37.1,
  },
  basisQuantity: 100,
  basisUnit: 'g',
  units: {},
}

const KARAAGE_GUESS: FoodMasterRef = {
  id: 'fm_karaage',
  name: '唐揚げ',
  isEstimated: true,
  nutritionPerBasis: {
    energy_kcal: 290,
    protein_g: 24.2,
    fat_g: 18.1,
    carb_g: 7.9,
  },
  basisQuantity: 100,
  basisUnit: 'g',
  units: {},
}

// 1 杯 (cup) of latte is defined as 200g so the ×0.5 serving test below
// resolves to a whole-number amountGrams.
const CAFE_LATTE: FoodMasterRef = {
  id: 'fm_latte',
  name: 'カフェラテ',
  isEstimated: false,
  nutritionPerBasis: {
    energy_kcal: 60,
    protein_g: 3.2,
    fat_g: 3.4,
    carb_g: 4.6,
  },
  basisQuantity: 100,
  basisUnit: 'g',
  units: { 杯: 200 },
}

const EXISTING_RICE_LOG: FoundMealLog = {
  log: {
    id: 'ml_1',
    foodMasterId: 'fm_rice',
    eatenDate: EATEN_DATE,
    mealType: 'dinner',
    quantity: 100,
    unit: 'g',
    amountGrams: 100,
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
  it('records a 100g meal and returns nutrition scaled by quantity/100', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
      },
    ])
  })

  it('scales nutrition linearly for a 200g meal', async () => {
    const { service } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 200,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 200,
      unit: 'g',
      amountGrams: 200,
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

  it.each(['G', ' g ', ' G '])(
    'normalizes the unit %p so it scales as grams',
    async (unit) => {
      const { service } = buildService([RICE])

      const result = (
        await service.record({
          foodMasterId: 'fm_rice',
          eatenDate: EATEN_DATE,
          mealType: 'dinner',
          quantity: 100,
          unit,
        })
      )._unsafeUnwrap()

      expect(result.nutrition).toEqual({
        energy_kcal: 156,
        protein_g: 2.5,
        fat_g: 0.3,
        carb_g: 37.1,
      })
    },
  )

  it('resolves 0.5 杯 via the food-specific unit definition (1 杯 = 200g)', async () => {
    const { service } = buildService([CAFE_LATTE])

    const result = (
      await service.record({
        foodMasterId: 'fm_latte',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 0.5,
        unit: '杯',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_latte',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 0.5,
      unit: '杯',
      amountGrams: 100,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 60,
        protein_g: 3.2,
        fat_g: 3.4,
        carb_g: 4.6,
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
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()
    const estimated = (
      await service.record({
        foodMasterId: 'fm_karaage',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(confirmed).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
    const future = '2026-06-17'

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenDate: future,
        mealType: 'dinner',
        quantity: 100,
        unit: 'g',
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
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: today,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
          unit: 'g',
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
        quantity: 100,
        unit: 'g',
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
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'snack',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
      },
    ])
  })

  it('rejects a unit undefined for the food_master with UnknownUnitError', async () => {
    const { service, inserted } = buildService([CAFE_LATTE])

    const error = (
      await service.record({
        foodMasterId: 'fm_latte',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
        unit: '個',
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnknownUnitError)
    expect(error).toEqual(new UnknownUnitError('個', ['杯']))
    expect(inserted).toEqual([])
  })

  it('rejects a resolved amount over 10kg with ImplausibleQuantityError', async () => {
    const HUGE_POT: FoodMasterRef = {
      id: 'fm_huge_pot',
      name: '寸胴鍋',
      isEstimated: false,
      nutritionPerBasis: { energy_kcal: 80 },
      basisQuantity: 100,
      basisUnit: 'g',
      units: { 鍋: 20000 },
    }
    const { service, inserted } = buildService([HUGE_POT])

    const error = (
      await service.record({
        foodMasterId: 'fm_huge_pot',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
        unit: '鍋',
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(ImplausibleQuantityError)
    expect(
      error instanceof ImplausibleQuantityError ? error.amountGrams : undefined,
    ).toBe(20000)
    expect(inserted).toEqual([])
  })

  it('rejects a foodName that does not match the resolved food_master with FoodNameMismatchError', async () => {
    const { service, inserted } = buildService([RICE])

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        foodName: '唐揚げ',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 100,
        unit: 'g',
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
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
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
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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
      await service.update({ id: 'ml_1', quantity: 200 })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 200,
      unit: 'g',
      amountGrams: 200,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 312,
        protein_g: 5,
        fat_g: 0.6,
        carb_g: 74.2,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([{ id: 'ml_1', quantity: 200, amountGrams: 200 }])
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
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 290,
        protein_g: 24.2,
        fat_g: 18.1,
        carb_g: 7.9,
      },
      isEstimated: true,
    })
    expect(updated).toEqual([
      { id: 'ml_1', foodMasterId: 'fm_karaage', amountGrams: 100 },
    ])
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
    expect(updated).toEqual([
      { id: 'ml_1', foodMasterId: 'fm_karaage', amountGrams: 100 },
    ])
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
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
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

  it('updates multiple fields together, recomputing amountGrams for the changed unit', async () => {
    // RICE with a food-specific 杯 definition — EXISTING_RICE_LOG is 100g,
    // which as a bare RICE fixture has no 杯 unit; give this test's food its
    // own units so resolving the new unit doesn't hit UnknownUnitError.
    const riceWithCupUnit: FoodMasterRef = { ...RICE, units: { 杯: 150 } }
    const existingLog: FoundMealLog = {
      log: EXISTING_RICE_LOG.log,
      food: riceWithCupUnit,
    }
    const { service, updated } = buildService([RICE], [existingLog])

    const result = (
      await service.update({
        id: 'ml_1',
        mealType: 'snack',
        quantity: 1,
        unit: '杯',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenDate: EATEN_DATE,
      mealType: 'snack',
      quantity: 1,
      unit: '杯',
      amountGrams: 150,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 156 * 1.5,
        protein_g: 2.5 * 1.5,
        fat_g: 0.3 * 1.5,
        carb_g: 37.1 * 1.5,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([
      {
        id: 'ml_1',
        mealType: 'snack',
        quantity: 1,
        unit: '杯',
        amountGrams: 150,
      },
    ])
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
      await service.update({ id: 'ml_missing', quantity: 100 })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(MealLogNotFoundError)
    expect(error instanceof MealLogNotFoundError ? error.id : undefined).toBe(
      'ml_missing',
    )
    expect(updated).toEqual([])
  })

  it('rejects an eatenDate strictly in the future with FutureEatenDateError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])
    const future = '2026-06-17'

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

  it('rejects a unit change undefined for the food_master with UnknownUnitError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

    const error = (
      await service.update({ id: 'ml_1', unit: '個' })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnknownUnitError)
    expect(error).toEqual(new UnknownUnitError('個', []))
    expect(updated).toEqual([])
  })

  it('rejects a resolved amount over 10kg with ImplausibleQuantityError', async () => {
    const hugePot: FoodMasterRef = {
      id: 'fm_huge_pot',
      name: '寸胴鍋',
      isEstimated: false,
      nutritionPerBasis: { energy_kcal: 80 },
      basisQuantity: 100,
      basisUnit: 'g',
      units: { 鍋: 20000 },
    }
    const existingLog: FoundMealLog = {
      log: { ...EXISTING_RICE_LOG.log, foodMasterId: 'fm_huge_pot' },
      food: hugePot,
    }
    const { service, updated } = buildService([], [existingLog])

    const error = (
      await service.update({ id: 'ml_1', quantity: 1, unit: '鍋' })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(ImplausibleQuantityError)
    expect(
      error instanceof ImplausibleQuantityError ? error.amountGrams : undefined,
    ).toBe(20000)
    expect(updated).toEqual([])
  })
})

describe('MealLogService.getById', () => {
  it('returns null when the log does not exist', async () => {
    const { service } = buildService([RICE])
    expect((await service.getById('ml_missing'))._unsafeUnwrap()).toBeNull()
  })

  it('returns a result with nutrition scaled for the stored quantity/unit', async () => {
    const repository: MealLogRepository = {
      findFoodMaster: () => errAsync(new DomainError('unused', 'unused')),
      insertMealLog: () => errAsync(new DomainError('unused', 'unused')),
      updateMealLog: () => errAsync(new DomainError('unused', 'unused')),
      findMealLogById: (id) =>
        okAsync({
          log: {
            id,
            foodMasterId: KARAAGE_GUESS.id,
            eatenDate: '2026-06-15',
            mealType: 'lunch',
            quantity: 200,
            unit: 'g',
            amountGrams: 200,
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
      quantity: 200,
      unit: 'g',
      amountGrams: 200,
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

// A food registered with a non-gram basis (e.g. a restaurant menu item
// published only as "913kcal per serving", with no weight in grams) computes
// correctly, and recording it in grams is structurally rejected.
describe('MealLogService.record with a non-gram basis food', () => {
  const KATSUDON: FoodMasterRef = {
    id: 'fm_katsudon',
    name: '味噌ロースかつ丼',
    isEstimated: false,
    nutritionPerBasis: {
      energy_kcal: 913,
      protein_g: 28.5,
      fat_g: 34.2,
      carb_g: 124.8,
    },
    basisQuantity: 1,
    basisUnit: '食',
    units: {},
  }

  it('records 1 食 as the full nutritionPerBasis (ratio 1)', async () => {
    const { service } = buildService([KATSUDON])

    const result = (
      await service.record({
        foodMasterId: 'fm_katsudon',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 1,
        unit: '食',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_katsudon',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 1,
      unit: '食',
      amountGrams: 1,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 913,
        protein_g: 28.5,
        fat_g: 34.2,
        carb_g: 124.8,
      },
      isEstimated: false,
    })
  })

  it('scales nutrition by 0.5 食', async () => {
    const { service } = buildService([KATSUDON])

    const result = (
      await service.record({
        foodMasterId: 'fm_katsudon',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 0.5,
        unit: '食',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_katsudon',
      eatenDate: EATEN_DATE,
      mealType: 'dinner',
      quantity: 0.5,
      unit: '食',
      amountGrams: 0.5,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 456.5,
        protein_g: 14.25,
        fat_g: 17.1,
        carb_g: 62.4,
      },
      isEstimated: false,
    })
  })

  it('rejects recording in grams with UnknownUnitError, since the food has no gram basis', async () => {
    const { service, inserted } = buildService([KATSUDON])

    const error = (
      await service.record({
        foodMasterId: 'fm_katsudon',
        eatenDate: EATEN_DATE,
        mealType: 'dinner',
        quantity: 200,
        unit: 'g',
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(UnknownUnitError)
    expect(error).toEqual(new UnknownUnitError('g', []))
    expect(inserted).toEqual([])
  })
})
