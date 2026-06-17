import { describe, expect, it } from 'vitest'

import {
  FoodMasterNotFoundError,
  FutureEatenAtError,
  InvalidQuantityError,
} from '@/domain/meal-log/errors'
import type {
  InsertMealLogInput,
  MealLogRepository,
} from '@/domain/meal-log/meal-log-repository'
import { createMealLogService } from '@/domain/meal-log/meal-log-service'
import type { FoodMasterRef, MealLogRow } from '@/domain/meal-log/types'

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
        return Promise.reject(new FoodMasterNotFoundError(id))
      }
      return Promise.resolve(food)
    },
    insertMealLog: (input) => {
      inserted.push(input)
      const row: MealLogRow = {
        id: input.id,
        foodMasterId: input.foodMasterId,
        eatenAt: input.eatenAt,
        quantity: input.quantity,
        unit: input.unit,
        note: input.note,
        createdAt: CREATED_AT,
      }
      return Promise.resolve(row)
    },
    findMealLogById: () => Promise.resolve(null),
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

    const result = await service.record({
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      quantity: 100,
      unit: 'g',
    })

    expect({ result, inserted }).toEqual({
      result: {
        id: 'ml_1',
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
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
      },
      inserted: [
        {
          id: 'ml_1',
          foodMasterId: 'fm_rice',
          eatenAt: EATEN_AT,
          quantity: 100,
          unit: 'g',
          note: null,
        },
      ],
    })
  })

  it('scales nutrition linearly for a 200g meal', async () => {
    const { service } = buildService([RICE])

    const result = await service.record({
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      quantity: 200,
      unit: 'g',
    })

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
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

      const result = await service.record({
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
        quantity: 100,
        unit,
      })

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

    const result = await service.record({
      foodMasterId: 'fm_latte',
      eatenAt: EATEN_AT,
      quantity: 0.5,
      unit: '杯',
    })

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_latte',
      eatenAt: EATEN_AT,
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

    const confirmed = await service.record({
      foodMasterId: 'fm_rice',
      eatenAt: EATEN_AT,
      quantity: 100,
      unit: 'g',
    })
    const estimated = await service.record({
      foodMasterId: 'fm_karaage',
      eatenAt: EATEN_AT,
      quantity: 100,
      unit: 'g',
    })

    expect([confirmed, estimated]).toEqual([
      {
        id: 'ml_1',
        foodMasterId: 'fm_rice',
        eatenAt: EATEN_AT,
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
      },
      {
        id: 'ml_2',
        foodMasterId: 'fm_karaage',
        eatenAt: EATEN_AT,
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
      },
    ])
  })

  it('rejects an eaten_at strictly in the future with FutureEatenAtError', async () => {
    const { service, inserted } = buildService([RICE])
    const future = new Date(NOW.getTime() + 1)

    const error = await service
      .record({
        foodMasterId: 'fm_rice',
        eatenAt: future,
        quantity: 100,
        unit: 'g',
      })
      .catch((e: unknown) => e)

    expect({
      isFutureError: error instanceof FutureEatenAtError,
      eatenAt: error instanceof FutureEatenAtError ? error.eatenAt : undefined,
      inserted,
    }).toEqual({
      isFutureError: true,
      eatenAt: future,
      inserted: [],
    })
  })

  it('allows eaten_at exactly equal to now', async () => {
    const { service } = buildService([RICE])

    const result = await service.record({
      foodMasterId: 'fm_rice',
      eatenAt: NOW,
      quantity: 100,
      unit: 'g',
    })

    expect(result).toEqual({
      id: 'ml_1',
      foodMasterId: 'fm_rice',
      eatenAt: NOW,
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

      const error = await service
        .record({
          foodMasterId: 'fm_rice',
          eatenAt: EATEN_AT,
          quantity,
          unit: 'g',
        })
        .catch((e: unknown) => e)

      expect({
        isInvalid: error instanceof InvalidQuantityError,
        quantity:
          error instanceof InvalidQuantityError ? error.quantity : undefined,
        inserted,
      }).toEqual({
        isInvalid: true,
        quantity,
        inserted: [],
      })
    },
  )

  it('surfaces FoodMasterNotFoundError from the repository when the id is missing', async () => {
    const { service, inserted } = buildService([RICE])

    const error = await service
      .record({
        foodMasterId: 'fm_missing',
        eatenAt: EATEN_AT,
        quantity: 100,
        unit: 'g',
      })
      .catch((e: unknown) => e)

    expect({
      isMissingError: error instanceof FoodMasterNotFoundError,
      foodMasterId:
        error instanceof FoodMasterNotFoundError
          ? error.foodMasterId
          : undefined,
      inserted,
    }).toEqual({
      isMissingError: true,
      foodMasterId: 'fm_missing',
      inserted: [],
    })
  })
})

describe('MealLogService.getById', () => {
  it('returns null when the log does not exist', async () => {
    const { service } = buildService([RICE])
    expect(await service.getById('ml_missing')).toBeNull()
  })

  it('returns a result with nutrition scaled for the stored quantity/unit', async () => {
    const repository: MealLogRepository = {
      findFoodMaster: () => Promise.reject(new Error('unused')),
      insertMealLog: () => Promise.reject(new Error('unused')),
      findMealLogById: (id) =>
        Promise.resolve({
          log: {
            id,
            foodMasterId: KARAAGE_GUESS.id,
            eatenAt: new Date('2026-06-15T12:00:00.000Z'),
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

    expect(await service.getById('ml_1')).toEqual({
      id: 'ml_1',
      foodMasterId: KARAAGE_GUESS.id,
      eatenAt: new Date('2026-06-15T12:00:00.000Z'),
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
