import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountDayDetailRoutes } from '#api/day-detail-routes'
import type { DayDetailService } from '#domain/day-detail/types'
import { DayDetailQueryError } from '#domain/day-detail/types'
import { jstDate } from '#test/jst-date'

const buildApp = (dayDetailService: DayDetailService): Hono => {
  const app = new Hono()
  mountDayDetailRoutes(app, dayDetailService)
  return app
}

const responseOutput = async (
  response: Response,
): Promise<{ status: number; body: unknown }> => ({
  status: response.status,
  body: await response.json(),
})

const stubEmptyDetail: DayDetailService = {
  query: () =>
    okAsync({
      totals: {},
      incompleteNutrients: [],
      hasEstimatedValues: false,
      hasUnknownValues: false,
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
          incompleteNutrients: [],
          hasEstimatedValues: false,
          hasUnknownValues: false,
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
          incompleteNutrients: ['protein_g'],
          hasEstimatedValues: false,
          hasUnknownValues: true,
          entries: [
            {
              id: 'log-recorded',
              foodMasterId: 'sample-food',
              foodName: '架空の食品',
              eatenDate: jstDate('2026-07-29'),
              mealType: 'breakfast',
              quantity: 2,
              kcal: 192,
              isEstimated: false,
              nutritionStatus: 'confirmed',
              nutritionVersion: {
                versionNo: 1,
                changeKind: 'initial',
                source: 'user_input',
                isEstimated: false,
                checkedOn: '2026-07-01',
                effectiveFrom: '2026-07-01',
              },
              nutritionVersionOrigin: 'recorded',
              nutritionVersionDifferences: [],
            },
            {
              id: 'log-migrated',
              foodMasterId: 'sample-food',
              foodName: '架空の食品',
              eatenDate: jstDate('2026-07-29'),
              mealType: 'lunch',
              quantity: 1,
              kcal: 120,
              isEstimated: false,
              nutritionStatus: 'confirmed',
              nutritionVersion: {
                versionNo: 1,
                changeKind: 'initial',
                source: 'user_input',
                isEstimated: false,
                checkedOn: null,
                effectiveFrom: null,
              },
              nutritionVersionOrigin: 'migrated',
              nutritionVersionDifferences: [
                {
                  versionNo: 2,
                  changeKind: 'product_update',
                  source: 'user_input',
                  isEstimated: false,
                  checkedOn: '2026-07-15',
                  effectiveFrom: '2026-07-10',
                },
              ],
            },
            {
              id: 'log-unversioned',
              foodMasterId: 'unknown-food',
              foodName: '名称不明の食品',
              eatenDate: jstDate('2026-07-29'),
              mealType: 'snack',
              quantity: 1,
              kcal: null,
              isEstimated: false,
              nutritionStatus: 'unknown',
              nutritionVersion: null,
              nutritionVersionOrigin: 'recorded',
              nutritionVersionDifferences: [],
            },
          ],
          skippedMealTypes: ['dinner'],
        }),
    }
    const app = buildApp(dayDetailService)

    const res = await app.request('/api/days/2026-07-29')

    expect(await responseOutput(res)).toEqual({
      status: 200,
      body: {
        date: '2026-07-29',
        totals: { energy_kcal: 312, protein_g: 5 },
        incompleteNutrients: ['protein_g'],
        hasEstimatedValues: false,
        hasUnknownValues: true,
        skippedMealTypes: ['dinner'],
        entries: [
          {
            id: 'log-recorded',
            foodMasterId: 'sample-food',
            foodName: '架空の食品',
            eatenDate: '2026-07-29',
            mealType: 'breakfast',
            quantity: 2,
            kcal: 192,
            isEstimated: false,
            nutritionStatus: 'confirmed',
            nutritionVersion: {
              versionNo: 1,
              changeKind: 'initial',
              source: 'user_input',
              isEstimated: false,
              checkedOn: '2026-07-01',
              effectiveFrom: '2026-07-01',
            },
            nutritionVersionOrigin: 'recorded',
            nutritionVersionDifferences: [],
          },
          {
            id: 'log-migrated',
            foodMasterId: 'sample-food',
            foodName: '架空の食品',
            eatenDate: '2026-07-29',
            mealType: 'lunch',
            quantity: 1,
            kcal: 120,
            isEstimated: false,
            nutritionStatus: 'confirmed',
            nutritionVersion: {
              versionNo: 1,
              changeKind: 'initial',
              source: 'user_input',
              isEstimated: false,
              checkedOn: null,
              effectiveFrom: null,
            },
            nutritionVersionOrigin: 'migrated',
            nutritionVersionDifferences: [
              {
                versionNo: 2,
                changeKind: 'product_update',
                source: 'user_input',
                isEstimated: false,
                checkedOn: '2026-07-15',
                effectiveFrom: '2026-07-10',
              },
            ],
          },
          {
            id: 'log-unversioned',
            foodMasterId: 'unknown-food',
            foodName: '名称不明の食品',
            eatenDate: '2026-07-29',
            mealType: 'snack',
            quantity: 1,
            kcal: null,
            isEstimated: false,
            nutritionStatus: 'unknown',
            nutritionVersion: null,
            nutritionVersionOrigin: 'recorded',
            nutritionVersionDifferences: [],
          },
        ],
      },
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
