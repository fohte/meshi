import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import {
  DomainError,
  FoodMasterNotFoundError,
  FutureEatenAtError,
  InvalidQuantityError,
  MealLogNotFoundError,
} from '#domain/meal-log/errors'
import type {
  FoundMealLog,
  InsertMealLogInput,
  MealLogRepository,
} from '#domain/meal-log/meal-log-repository'
import { createMealLogService } from '#domain/meal-log/meal-log-service'
import type {
  FoodMasterRef,
  MealLogRow,
  UpdateMealLogInput,
} from '#domain/meal-log/types'

const NOW = new Date('2026-06-16T12:00:00.000Z')
const CREATED_AT = new Date('2026-06-16T12:00:00.500Z')
const EATEN_AT = new Date('2026-06-16T09:00:00.000Z')

interface FakeRepoOptions {
  readonly foodMasters: ReadonlyArray<FoodMasterRef>
  readonly existingLogs?: ReadonlyArray<FoundMealLog>
}

const createFakeRepository = (
  options: FakeRepoOptions,
): {
  repository: MealLogRepository
  inserted: InsertMealLogInput[]
  updated: UpdateMealLogInput[]
} => {
  const foodMasterById = new Map(options.foodMasters.map((f) => [f.id, f]))
  const logs = new Map(
    (options.existingLogs ?? []).map((found) => [found.log.id, found]),
  )
  const inserted: InsertMealLogInput[] = []
  const updated: UpdateMealLogInput[] = []
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
        note: input.note,
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
        ...(input.eatenAt === undefined ? {} : { eatenAt: input.eatenAt }),
        ...(input.mealType === undefined ? {} : { mealType: input.mealType }),
        ...(input.quantity === undefined ? {} : { quantity: input.quantity }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.note === undefined ? {} : { note: input.note }),
      }
      logs.set(input.id, { log: merged, food: existing.food })
      return okAsync(merged)
    },
    findMealLogById: (id) => okAsync(logs.get(id) ?? null),
  }
  return { repository, inserted, updated }
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
}

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
}

const EXISTING_RICE_LOG: FoundMealLog = {
  log: {
    id: 'ml_1',
    foodMasterId: 'fm_rice',
    eatenAt: EATEN_AT,
    mealType: 'dinner',
    quantity: 100,
    unit: 'g',
    note: null,
    createdAt: CREATED_AT,
  },
  food: RICE,
}

const buildService = (
  foodMasters: ReadonlyArray<FoodMasterRef>,
  existingLogs: ReadonlyArray<FoundMealLog> = [],
) => {
  const { repository, inserted, updated } = createFakeRepository({
    foodMasters,
    existingLogs,
  })
  const ids = ['ml_1', 'ml_2', 'ml_3']
  let idx = 0
  const service = createMealLogService({
    repository,
    idGenerator: () => ids[idx++] ?? 'ml_overflow',
    now: () => NOW,
  })
  return { service, inserted, updated }
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

  it('treats non-gram units as per-serving so 0.5 杯 multiplies by 0.5', async () => {
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
      note: null,
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 30,
        protein_g: 1.6,
        fat_g: 1.7,
        carb_g: 2.3,
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
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
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
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 200,
      unit: 'g',
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
    expect(updated).toEqual([{ id: 'ml_1', quantity: 200 }])
  })

  it('changes food_master_id and recomputes nutrition against the new food', async () => {
    const { service, updated } = buildService(
      [RICE, KARAAGE_GUESS],
      [EXISTING_RICE_LOG],
    )

    const result = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_karaage' })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_karaage',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
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
    expect(updated).toEqual([{ id: 'ml_1', foodMasterId: 'fm_karaage' }])
  })

  it('does not re-fetch food_master when foodMasterId equals the current value', async () => {
    // RICE is deliberately absent from foodMasters: if the service mistakenly
    // called findFoodMaster for an unchanged id, this would fail with
    // FoodMasterNotFoundError instead of reusing the already-loaded food.
    const { service, updated } = buildService([], [EXISTING_RICE_LOG])

    const result = (
      await service.update({ id: 'ml_1', foodMasterId: 'fm_rice' })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'dinner',
      quantity: 100,
      unit: 'g',
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
    expect(updated).toEqual([{ id: 'ml_1', foodMasterId: 'fm_rice' }])
  })

  it('updates multiple fields together and forwards only the provided ones', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

    const result = (
      await service.update({
        id: 'ml_1',
        mealType: 'snack',
        unit: '杯',
        note: 'まとめて訂正',
      })
    )._unsafeUnwrap()

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      mealType: 'snack',
      quantity: 100,
      unit: '杯',
      note: 'まとめて訂正',
      createdAt: CREATED_AT,
      nutrition: {
        energy_kcal: 15600,
        protein_g: 250,
        fat_g: 30,
        carb_g: 3710,
      },
      isEstimated: false,
    })
    expect(updated).toEqual([
      { id: 'ml_1', mealType: 'snack', unit: '杯', note: 'まとめて訂正' },
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

  it('rejects an eaten_at strictly in the future with FutureEatenAtError', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])
    const future = new Date(NOW.getTime() + 1)

    const error = (
      await service.update({ id: 'ml_1', eatenAt: future })
    )._unsafeUnwrapErr()

    expect(error).toBeInstanceOf(FutureEatenAtError)
    expect(
      error instanceof FutureEatenAtError ? error.eatenAt : undefined,
    ).toEqual(future)
    expect(updated).toEqual([])
  })

  it('allows eaten_at exactly equal to now', async () => {
    const { service, updated } = buildService([RICE], [EXISTING_RICE_LOG])

    const result = (
      await service.update({ id: 'ml_1', eatenAt: NOW })
    )._unsafeUnwrap()

    expect(result.eatenAt).toEqual(NOW)
    expect(updated).toEqual([{ id: 'ml_1', eatenAt: NOW }])
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
            eatenAt: new Date('2026-06-15T12:00:00.000Z'),
            mealType: 'lunch',
            quantity: 200,
            unit: 'g',
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
