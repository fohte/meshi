import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountMealPlanRoutes } from '#api/meal-plan-routes'
import {
  MealPlanNotFoundError,
  MealPlanPersistenceError,
  PastMealPlanDateError,
} from '#domain/meal-plan/errors'
import type { MealPlanService } from '#domain/meal-plan/meal-plan-service'
import type { MealPlan } from '#domain/meal-plan/types'
import { jstDate } from '#test/jst-date'

const SAMPLE_PLAN_ID = '00000000-0000-7000-8000-000000000001'

const SAMPLE_PLAN: MealPlan = {
  id: SAMPLE_PLAN_ID,
  date: jstDate('2026-11-10'),
  mealType: 'lunch',
  items: [
    {
      foodMasterId: 'fm_web_plan_example',
      foodName: 'example vegetable',
      quantity: 1.5,
      energyKcalPerUnit: 38,
    },
    {
      foodMasterId: 'fm_web_plan_other',
      foodName: 'example grain',
      quantity: 0.5,
      energyKcalPerUnit: null,
    },
  ],
  reason: 'use ingredients on hand',
  status: 'planned',
  createdAt: new Date('2026-11-10T03:00:00.000Z'),
}

const SAMPLE_JSON = {
  id: SAMPLE_PLAN_ID,
  date: '2026-11-10',
  mealType: 'lunch',
  reason: 'use ingredients on hand',
  status: 'planned',
  items: [
    {
      foodMasterId: 'fm_web_plan_example',
      foodName: 'example vegetable',
      quantity: 1.5,
      energyKcalPerUnit: 38,
    },
    {
      foodMasterId: 'fm_web_plan_other',
      foodName: 'example grain',
      quantity: 0.5,
      energyKcalPerUnit: null,
    },
  ],
}

const buildApp = (mealPlanService: MealPlanService): Hono => {
  const app = new Hono()
  mountMealPlanRoutes(app, mealPlanService)
  return app
}

const notStubbed = (name: string): MealPlanService => ({
  save: () =>
    errAsync(new MealPlanPersistenceError(`${name}.save not stubbed`)),
  list: () =>
    errAsync(new MealPlanPersistenceError(`${name}.list not stubbed`)),
  cancel: () =>
    errAsync(new MealPlanPersistenceError(`${name}.cancel not stubbed`)),
})

const jsonRequest = (path: string, method: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const responseSnapshot = async (res: Response) => ({
  status: res.status,
  body: await res.json(),
})

const responseWithCaptured = async (res: Response, captured: unknown) => ({
  response: await responseSnapshot(res),
  captured,
})

describe('GET /api/meal-plans', () => {
  it('lists the requested half-open date range with per-item kcal', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      list: (from, to) => {
        captured = { from, to }
        return okAsync([SAMPLE_PLAN])
      },
    })

    const res = await app.request(
      '/api/meal-plans?from=2026-11-10&to=2026-11-12',
    )

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: { status: 200, body: [SAMPLE_JSON] },
      captured: { from: '2026-11-10', to: '2026-11-12' },
    })
  })

  it('returns 400 when the date range is malformed', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      '/api/meal-plans?from=2026-02-30&to=2026-03-01',
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: {
        error:
          'must be a valid YYYY-MM-DD JST calendar date, got: "2026-02-30"',
      },
    })
  })

  it('maps a persistence error to 500', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      list: () => errAsync(new MealPlanPersistenceError('storage unavailable')),
    })

    const res = await app.request(
      '/api/meal-plans?from=2026-11-10&to=2026-11-11',
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 500,
      body: { error: 'storage unavailable' },
    })
  })
})

describe('PUT /api/meal-plans/:date/:mealType', () => {
  it('saves items and reason for the URL slot', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      save: (input) => {
        captured = input
        return okAsync(SAMPLE_PLAN)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-plans/2026-11-10/lunch', 'PUT', {
        items: [
          {
            foodMasterId: 'fm_web_plan_example',
            foodName: 'example vegetable',
            quantity: 1.5,
          },
        ],
        reason: 'use ingredients on hand',
      }),
    )

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: { status: 200, body: SAMPLE_JSON },
      captured: {
        date: '2026-11-10',
        mealType: 'lunch',
        items: [
          {
            foodMasterId: 'fm_web_plan_example',
            foodName: 'example vegetable',
            quantity: 1.5,
          },
        ],
        reason: 'use ingredients on hand',
      },
    })
  })

  it('returns 400 when the URL date is malformed', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-plans/2026-02-30/lunch', 'PUT', { items: [] }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: {
        error:
          'must be a valid YYYY-MM-DD JST calendar date, got: "2026-02-30"',
      },
    })
  })

  it('maps a past-date rejection to 400', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      save: () => errAsync(new PastMealPlanDateError(jstDate('2026-11-09'))),
    })

    const res = await app.request(
      jsonRequest('/api/meal-plans/2026-11-09/lunch', 'PUT', {
        items: [
          {
            foodMasterId: 'fm_web_plan_example',
            foodName: 'example vegetable',
            quantity: 1,
          },
        ],
      }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'planned date must not be before today: 2026-11-09' },
    })
  })

  it('returns 400 for malformed JSON', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-plans/2026-11-10/lunch', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'request body must be valid JSON' },
    })
  })

  it('returns 400 when valid JSON does not match the write schema', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-plans/2026-11-10/lunch', 'PUT', {
        items: [
          {
            foodMasterId: 'fm_web_plan_example',
            foodName: 'example vegetable',
            quantity: '1.5',
          },
        ],
      }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: {
        error: 'Invalid input: expected number, received string',
      },
    })
  })
})

describe('POST /api/meal-plans/:id/cancel', () => {
  it('cancels the plan and returns the cancelled result', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      cancel: (id) => {
        captured = id
        return okAsync({ ...SAMPLE_PLAN, status: 'cancelled' })
      },
    })

    const res = await app.request(`/api/meal-plans/${SAMPLE_PLAN_ID}/cancel`, {
      method: 'POST',
    })

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: {
        status: 200,
        body: { ...SAMPLE_JSON, status: 'cancelled' },
      },
      captured: SAMPLE_PLAN_ID,
    })
  })

  it('returns 404 when the plan does not exist', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      cancel: () => errAsync(new MealPlanNotFoundError(SAMPLE_PLAN_ID)),
    })

    const res = await app.request(`/api/meal-plans/${SAMPLE_PLAN_ID}/cancel`, {
      method: 'POST',
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: `meal_plan not found: ${SAMPLE_PLAN_ID}` },
    })
  })

  it('returns 400 when the id is not a UUID', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-plans/invalid-id/cancel', {
      method: 'POST',
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'Invalid UUID' },
    })
  })
})
