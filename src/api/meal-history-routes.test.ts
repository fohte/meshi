import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountMealHistoryRoutes } from '#api/meal-history-routes'
import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { MealHistoryService } from '#domain/meal-history/types'
import { MealHistoryQueryError } from '#domain/meal-history/types'

const buildApp = (mealHistoryService: MealHistoryService): Hono => {
  const app = new Hono()
  mountMealHistoryRoutes(app, mealHistoryService)
  return app
}

const stubEmptyAggregate: MealHistoryService = {
  query: () =>
    okAsync({ totals: {}, perDay: [], entries: [], hasEstimatedValues: false }),
}

describe('GET /api/meal-history', () => {
  it('returns 400 when from/to are missing', async () => {
    const app = buildApp(stubEmptyAggregate)

    const res = await app.request('/api/meal-history')

    expect(res.status).toBe(400)
  })

  it('converts from/to query params into a service query', async () => {
    let capturedInput: unknown
    const mealHistoryService: MealHistoryService = {
      query: (input) => {
        capturedInput = input
        return okAsync({
          totals: {},
          perDay: [],
          entries: [],
          hasEstimatedValues: false,
        })
      },
    }
    const app = buildApp(mealHistoryService)

    await app.request('/api/meal-history?from=2026-07-29&to=2026-07-30')

    expect(capturedInput).toEqual({
      periodFrom: '2026-07-29',
      periodTo: '2026-07-30',
      nutrientCodes: NUTRIENT_CODES,
    })
  })

  it('renders the service aggregate as the response body', async () => {
    const mealHistoryService: MealHistoryService = {
      query: () =>
        okAsync({
          totals: { energy_kcal: 100 },
          perDay: [{ date: '2026-07-29', totals: { energy_kcal: 100 } }],
          entries: [
            {
              id: 'log-1',
              foodMasterId: 'rice',
              foodName: 'rice',
              eatenDate: '2026-07-29',
              mealType: 'breakfast',
              quantity: 100,
              unit: 'g',
            },
          ],
          hasEstimatedValues: false,
        }),
    }
    const app = buildApp(mealHistoryService)

    const res = await app.request(
      '/api/meal-history?from=2026-07-29&to=2026-07-30',
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      totals: { energy_kcal: 100 },
      perDay: [{ date: '2026-07-29', totals: { energy_kcal: 100 } }],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'rice',
          eatenDate: '2026-07-29',
          mealType: 'breakfast',
          quantity: 100,
          unit: 'g',
        },
      ],
      hasEstimatedValues: false,
    })
  })

  it('returns 500 when the service query fails', async () => {
    const app = buildApp({
      query: () => errAsync(new MealHistoryQueryError('boom')),
    })

    const res = await app.request(
      '/api/meal-history?from=2026-07-29&to=2026-07-30',
    )

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
