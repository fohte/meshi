import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  DomainError,
  FoodMasterNotFoundError,
  FutureEatenAtError,
  ImplausibleQuantityError,
  InvalidQuantityError,
  UnknownUnitError,
} from '#domain/meal-log/errors'
import type {
  InsertMealLogInput,
  MealLogRepository,
} from '#domain/meal-log/meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type { FoodMasterRef, MealLogRow } from '#domain/meal-log/types'

const NOW = new Date('2026-06-16T12:00:00.000Z')
const CREATED_AT = new Date('2026-06-16T12:00:00.500Z')
const EATEN_AT = new Date('2026-06-16T09:00:00.000Z')

interface FakeRepoOptions {
  readonly foodMasters: ReadonlyArray<FoodMasterRef>
}

const createFakeRepository = (
  options: FakeRepoOptions,
): {
  repository: MealLogRepository
  inserted: InsertMealLogInput[]
} => {
  const foodMasterById = new Map(options.foodMasters.map((f) => [f.id, f]))
  const inserted: InsertMealLogInput[] = []
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
        eatenAt: input.eatenAt,
        mealType: input.mealType,
        quantity: input.quantity,
        unit: input.unit,
        amountGrams: input.amountGrams,
        note: input.note,
        createdAt: CREATED_AT,
      }
      return okAsync(row)
    },
    findMealLogById: () => okAsync(null),
  }
  return { repository, inserted }
}

const RICE: FoodMasterRef = {
  id: 'fm_rice',
  name: '白米',
  isEstimated: false,
  nutritionPer100g: {
    energy_kcal: 156,
    protein_g: 2.5,
    fat_g: 0.3,
    carb_g: 37.1,
  },
  units: {},
}

const KARAAGE_GUESS: FoodMasterRef = {
  id: 'fm_karaage',
  name: '唐揚げ',
  isEstimated: true,
  nutritionPer100g: {
    energy_kcal: 290,
    protein_g: 24.2,
    fat_g: 18.1,
    carb_g: 7.9,
  },
  units: {},
}

// 1 杯 (cup) of latte is defined as 200g so the ×0.5 serving test below
// resolves to a whole-number amountGrams.
const CAFE_LATTE: FoodMasterRef = {
  id: 'fm_latte',
  name: 'カフェラテ',
  isEstimated: false,
  nutritionPer100g: {
    energy_kcal: 60,
    protein_g: 3.2,
    fat_g: 3.4,
    carb_g: 4.6,
  },
  units: { 杯: 200 },
}

const buildService = (foodMasters: ReadonlyArray<FoodMasterRef>) => {
  const { repository, inserted } = createFakeRepository({ foodMasters })
  const ids = ['ml_1', 'ml_2', 'ml_3']
  let idx = 0
  const service = createMealLogService({
    repository,
    idGenerator: () => ids[idx++] ?? 'ml_overflow',
    now: () => NOW,
  })
  return { service, inserted }
}

describe('MealLogService.record', () => {
  it('records a 100g meal and returns nutrition scaled by quantity/100', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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
        eatenAt: EATEN_AT,
        mealType: 'dinner',
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
        note: null,
      },
    ])
  })

  it('scales nutrition linearly for a 200g meal', async () => {
    const { service } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
        quantity: 200,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 200,
      unit: 'g',
      amountGrams: 200,
      note: null,
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
          eatenAt: EATEN_AT,
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
        eatenAt: EATEN_AT,
        quantity: 0.5,
        unit: '杯',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_latte',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 0.5,
      unit: '杯',
      amountGrams: 100,
      note: null,
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
        eatenAt: EATEN_AT,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()
    const estimated = (
      await service.record({
        foodMasterId: 'fm_karaage',
        eatenAt: EATEN_AT,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(confirmed).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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

  it('rejects an eaten_at strictly in the future with FutureEatenAtError', async () => {
    const { service, inserted } = buildService([RICE])
    const future = new Date(NOW.getTime() + 1)

    const error = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: future,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FutureEatenAtError)
    expect(
      error instanceof FutureEatenAtError ? error.eatenAt : undefined,
    ).toEqual(future)
    expect(inserted).toEqual([])
  })

  it('allows eaten_at exactly equal to now', async () => {
    const { service } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: NOW,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: NOW,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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
          eatenAt: EATEN_AT,
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
        eatenAt: EATEN_AT,
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

  it('uses the given mealType verbatim instead of the time-of-day default', async () => {
    const { service, inserted } = buildService([RICE])

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
        mealType: 'snack',
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'snack',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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
        eatenAt: EATEN_AT,
        mealType: 'snack',
        quantity: 100,
        unit: 'g',
        amountGrams: 100,
        note: null,
      },
    ])
  })

  it('defaults mealType from eaten_at when omitted', async () => {
    const { service } = buildService([RICE])
    const eatenAt = new Date('2026-06-15T23:30:00.000Z') // 08:30 JST

    const result = (
      await service.record({
        foodMasterId: 'fm_rice',
        eatenAt,
        quantity: 100,
        unit: 'g',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt,
      mealType: 'breakfast',
      quantity: 100,
      unit: 'g',
      amountGrams: 100,
      note: null,
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

  it('rejects a unit undefined for the food_master with UnknownUnitError', async () => {
    const { service, inserted } = buildService([CAFE_LATTE])

    const error = (
      await service.record({
        foodMasterId: 'fm_latte',
        eatenAt: EATEN_AT,
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
      nutritionPer100g: { energy_kcal: 80 },
      units: { 鍋: 20000 },
    }
    const { service, inserted } = buildService([HUGE_POT])

    const error = (
      await service.record({
        foodMasterId: 'fm_huge_pot',
        eatenAt: EATEN_AT,
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
      findMealLogById: (id) =>
        okAsync({
          log: {
            id,
            foodMasterId: KARAAGE_GUESS.id,
            eatenAt: new Date('2026-06-15T12:00:00.000Z'),
            mealType: 'lunch',
            quantity: 200,
            unit: 'g',
            amountGrams: 200,
            note: 'lunch',
            createdAt: CREATED_AT,
          },
          food: KARAAGE_GUESS,
        }),
    }
    const service = createMealLogService({
      repository,
      idGenerator: () => 'unused',
      now: () => NOW,
    })

    expect((await service.getById('ml_1'))._unsafeUnwrap()).toEqual({
      id: 'ml_1',
      foodMasterId: KARAAGE_GUESS.id,
      eatenAt: new Date('2026-06-15T12:00:00.000Z'),
      mealType: 'lunch',
      quantity: 200,
      unit: 'g',
      amountGrams: 200,
      note: 'lunch',
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
