import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountDayDetailRoutes } from '#api/day-detail-routes'
import type { DayDetailService } from '#domain/day-detail/types'
import { DayDetailQueryError } from '#domain/day-detail/types'

const buildApp = (dayDetailService: DayDetailService): Hono => {
  const app = new Hono()
  mountDayDetailRoutes(app, dayDetailService)
  return app
}

const stubEmptyDetail: DayDetailService = {
  query: () =>
    okAsync({
      totals: {},
      hasEstimatedValues: false,
      entries: [],
      skippedMealTypes: [],
    }),
}

describe('GET /api/days/:date', () => {
  it('returns 400 for a non YYYY-MM-DD date', async () => {
    const app = buildApp(stubEmptyDetail)

    const res = await app.request('/api/days/2026-07-99')

    expect(res.status).toBe(400)
  })

  it('converts the date param into a service query', async () => {
    let capturedInput: unknown
    const dayDetailService: DayDetailService = {
      query: (input) => {
        capturedInput = input
        return okAsync({
          totals: {},
          hasEstimatedValues: false,
          entries: [],
          skippedMealTypes: [],
        })
      },
    }
    const app = buildApp(dayDetailService)

    await app.request('/api/days/2026-07-29')

    expect(capturedInput).toEqual({ date: '2026-07-29' })
  })

  it('renders the service detail as the response body', async () => {
    const dayDetailService: DayDetailService = {
      query: () =>
        okAsync({
          totals: { energy_kcal: 312, protein_g: 5 },
          hasEstimatedValues: true,
          entries: [
            {
              id: 'log-1',
              foodMasterId: 'rice',
              foodName: 'ごはん',
              eatenDate: '2026-07-29',
              mealType: 'breakfast',
              quantity: 200,
              unit: 'g',
              kcal: 312,
              isEstimated: false,
            },
          ],
          skippedMealTypes: ['lunch'],
        }),
    }
    const app = buildApp(dayDetailService)

    const res = await app.request('/api/days/2026-07-29')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      date: '2026-07-29',
      totals: { energy_kcal: 312, protein_g: 5 },
      hasEstimatedValues: true,
      skippedMealTypes: ['lunch'],
      entries: [
        {
          id: 'log-1',
          foodMasterId: 'rice',
          foodName: 'ごはん',
          eatenDate: '2026-07-29',
          mealType: 'breakfast',
          quantity: 200,
          unit: 'g',
          kcal: 312,
          isEstimated: false,
        },
      ],
    })
  })

  it('returns 500 when the service query fails', async () => {
    const app = buildApp({
      query: () => errAsync(new DayDetailQueryError('boom')),
    })

    const res = await app.request('/api/days/2026-07-29')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
