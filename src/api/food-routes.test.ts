import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountFoodRoutes } from '#api/food-routes'
import type { FoodBrowseService, FoodListItem } from '#domain/food-browse/types'
import { FoodBrowseQueryError } from '#domain/food-browse/types'
import type { FoodDetail, FoodDetailService } from '#domain/food-detail/types'
import { FoodDetailQueryError } from '#domain/food-detail/types'
import { jstDate } from '#test/jst-date'

const stubItem: FoodListItem = {
  foodMasterId: 'fm_1',
  compositionCode: null,
  name: 'rice',
  isEstimated: false,
  reason: 'fuzzy_name',
  source: 'user_input',
  energyKcalPer100g: 168,
}

const buildApp = (
  foodBrowseService: FoodBrowseService,
  foodDetailService: FoodDetailService,
): Hono => {
  const app = new Hono()
  mountFoodRoutes(app, { foodBrowseService, foodDetailService })
  return app
}

const stubFoodDetailService: FoodDetailService = {
  getById: () => okAsync(null),
}

describe('GET /api/foods/search', () => {
  it('applies default q/limit when omitted', async () => {
    let captured: { query: string; limit: number } | undefined
    const foodBrowseService: FoodBrowseService = {
      search: (query, limit) => {
        captured = { query, limit }
        return okAsync([])
      },
      listRecent: () => okAsync([]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    await app.request('/api/foods/search')

    expect(captured).toEqual({ query: '', limit: 20 })
  })

  it('renders the service result as JSON', async () => {
    const foodBrowseService: FoodBrowseService = {
      search: () => okAsync([stubItem]),
      listRecent: () => okAsync([]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/search')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      items: [
        {
          foodMasterId: 'fm_1',
          compositionCode: null,
          name: 'rice',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'user_input',
          energyKcalPer100g: 168,
        },
      ],
    })
  })

  it('passes through q and a coerced limit', async () => {
    let captured: { query: string; limit: number } | undefined
    const foodBrowseService: FoodBrowseService = {
      search: (query, limit) => {
        captured = { query, limit }
        return okAsync([])
      },
      listRecent: () => okAsync([]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    await app.request('/api/foods/search?q=rice&limit=5')

    expect(captured).toEqual({ query: 'rice', limit: 5 })
  })

  it('returns 400 for a limit above the max', async () => {
    const foodBrowseService: FoodBrowseService = {
      search: () => okAsync([]),
      listRecent: () => okAsync([]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/search?limit=1000')

    expect(res.status).toBe(400)
  })

  it('returns 500 when the service query fails', async () => {
    const foodBrowseService: FoodBrowseService = {
      search: () => errAsync(new FoodBrowseQueryError('boom')),
      listRecent: () => okAsync([]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/search?q=rice')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})

describe('GET /api/foods/suggestions', () => {
  it('applies the default limit to both recent and frequent', async () => {
    const limits: number[] = []
    const foodBrowseService: FoodBrowseService = {
      search: () => okAsync([]),
      listRecent: (limit) => {
        limits.push(limit)
        return okAsync([])
      },
      listFrequent: (limit) => {
        limits.push(limit)
        return okAsync([])
      },
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    await app.request('/api/foods/suggestions')

    expect(limits).toEqual([5, 5])
  })

  it('renders recent and frequent lists side by side', async () => {
    const foodBrowseService: FoodBrowseService = {
      search: () => okAsync([]),
      listRecent: () => okAsync([stubItem]),
      listFrequent: () => okAsync([]),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/suggestions')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      recent: [
        {
          foodMasterId: 'fm_1',
          compositionCode: null,
          name: 'rice',
          isEstimated: false,
          reason: 'fuzzy_name',
          source: 'user_input',
          energyKcalPer100g: 168,
        },
      ],
      frequent: [],
    })
  })

  it('returns 500 when either query fails', async () => {
    const foodBrowseService: FoodBrowseService = {
      search: () => okAsync([]),
      listRecent: () => okAsync([]),
      listFrequent: () => errAsync(new FoodBrowseQueryError('boom')),
    }
    const app = buildApp(foodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/suggestions')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})

describe('GET /api/foods/:id', () => {
  const stubFoodBrowseService: FoodBrowseService = {
    search: () => okAsync([]),
    listRecent: () => okAsync([]),
    listFrequent: () => okAsync([]),
  }

  it('renders the food detail as JSON', async () => {
    const detail: FoodDetail = {
      id: 'fm_1',
      name: 'rice',
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      aliases: ['ご飯'],
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 168 },
      history: [
        {
          id: 'ml_1',
          eatenDate: jstDate('2026-07-29'),
          mealType: 'breakfast',
          amountGrams: 100,
          quantity: 100,
          unit: 'g',
        },
      ],
      totalEatenCount: 1,
    }
    const foodDetailService: FoodDetailService = {
      getById: () => okAsync(detail),
    }
    const app = buildApp(stubFoodBrowseService, foodDetailService)

    const res = await app.request('/api/foods/fm_1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 'fm_1',
      name: 'rice',
      isEstimated: false,
      source: 'user_input',
      sourceUrl: null,
      aliases: ['ご飯'],
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 168 },
      totalEatenCount: 1,
      history: [
        {
          id: 'ml_1',
          eatenDate: '2026-07-29',
          mealType: 'breakfast',
          amountGrams: 100,
          quantity: 100,
          unit: 'g',
        },
      ],
    })
  })

  it('returns 404 when the food does not exist', async () => {
    const app = buildApp(stubFoodBrowseService, stubFoodDetailService)

    const res = await app.request('/api/foods/missing')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'food not found' })
  })

  it('returns 500 when the service query fails', async () => {
    const foodDetailService: FoodDetailService = {
      getById: () => errAsync(new FoodDetailQueryError('boom')),
    }
    const app = buildApp(stubFoodBrowseService, foodDetailService)

    const res = await app.request('/api/foods/fm_1')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
