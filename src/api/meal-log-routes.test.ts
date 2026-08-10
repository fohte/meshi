import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mountMealLogRoutes } from '#api/meal-log-routes'
import {
  FoodMasterNotFoundError,
  FutureEatenDateError,
  InvalidQuantityError,
  MealLogNotFoundError,
  MealLogPersistenceError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult } from '#domain/meal-log/types'
import { jstDate } from '#test/jst-date'

const errorResponseSchema = z.object({ error: z.string() })

const buildApp = (mealLogService: MealLogService): Hono => {
  const app = new Hono()
  mountMealLogRoutes(app, mealLogService)
  return app
}

const SAMPLE_RESULT: MealLogResult = {
  id: 'ml_1',
  foodMasterId: 'fm_rice',
  eatenDate: jstDate('2026-06-18'),
  mealType: 'lunch',
  quantity: 150,
  createdAt: new Date('2026-06-18T00:00:01.000Z'),
  nutrition: { energy_kcal: 234 },
  isEstimated: false,
}

const SAMPLE_JSON = {
  id: 'ml_1',
  foodMasterId: 'fm_rice',
  eatenDate: '2026-06-18',
  mealType: 'lunch',
  quantity: 150,
  nutrition: { energy_kcal: 234 },
  isEstimated: false,
  createdAt: '2026-06-18T00:00:01.000Z',
}

const jsonRequest = (path: string, method: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const notStubbed = (name: string): MealLogService => ({
  record: () =>
    errAsync(new MealLogPersistenceError(`${name}.record not stubbed`)),
  update: () =>
    errAsync(new MealLogPersistenceError(`${name}.update not stubbed`)),
  getById: () =>
    errAsync(new MealLogPersistenceError(`${name}.getById not stubbed`)),
  delete: () =>
    errAsync(new MealLogPersistenceError(`${name}.delete not stubbed`)),
})

describe('POST /api/meal-logs', () => {
  it('records a meal log and returns 201 with the result', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      record: (input) => {
        captured = input
        return okAsync(SAMPLE_RESULT)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-logs', 'POST', {
        foodMasterId: 'fm_rice',
        eatenDate: '2026-06-18',
        mealType: 'lunch',
        quantity: 150,
      }),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual(SAMPLE_JSON)
    expect(captured).toEqual({
      foodMasterId: 'fm_rice',
      eatenDate: '2026-06-18',
      mealType: 'lunch',
      quantity: 150,
    })
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-logs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'request body must be valid JSON',
    })
  })

  it('returns 400 when the body fails schema validation', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-logs', 'POST', { foodMasterId: 'fm_rice' }),
    )

    expect(res.status).toBe(400)
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('returns 400 when mealType is missing', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-logs', 'POST', {
        foodMasterId: 'fm_rice',
        eatenDate: '2026-06-18',
        quantity: 150,
      }),
    )

    expect(res.status).toBe(400)
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it.each([
    [new FutureEatenDateError(jstDate('2099-01-01')), 400],
    [new InvalidQuantityError(-1), 400],
    [new FoodMasterNotFoundError('fm_missing'), 404],
    [new MealLogPersistenceError('boom'), 500],
  ])('maps %s to status %i', async (error, status) => {
    const app = buildApp({
      ...notStubbed('service'),
      record: () => errAsync(error),
    })

    const res = await app.request(
      jsonRequest('/api/meal-logs', 'POST', {
        foodMasterId: 'fm_rice',
        eatenDate: '2026-06-18',
        mealType: 'lunch',
        quantity: 150,
      }),
    )

    expect(res.status).toBe(status)
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })
})

describe('PATCH /api/meal-logs/:id', () => {
  it('forwards only the given fields and returns the updated result', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      update: (input) => {
        captured = input
        return okAsync(SAMPLE_RESULT)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-logs/ml_1', 'PATCH', { quantity: 200 }),
    )

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SAMPLE_JSON)
    expect(captured).toEqual({ id: 'ml_1', quantity: 200 })
  })

  it('returns 404 when the log does not exist', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      update: () => errAsync(new MealLogNotFoundError('ml_missing')),
    })

    const res = await app.request(
      jsonRequest('/api/meal-logs/ml_missing', 'PATCH', { quantity: 200 }),
    )

    expect(res.status).toBe(404)
  })

  it('returns 400 when the body fails schema validation', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-logs/ml_1', 'PATCH', { quantity: -1 }),
    )

    expect(res.status).toBe(400)
  })
})

describe('DELETE /api/meal-logs/:id', () => {
  it('returns 204 on success', async () => {
    let capturedId: unknown
    const app = buildApp({
      ...notStubbed('service'),
      delete: (id) => {
        capturedId = id
        return okAsync(undefined)
      },
    })

    const res = await app.request(jsonRequest('/api/meal-logs/ml_1', 'DELETE'))

    expect(res.status).toBe(204)
    expect(capturedId).toBe('ml_1')
  })

  it('returns 404 when the log does not exist', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      delete: () => errAsync(new MealLogNotFoundError('ml_missing')),
    })

    const res = await app.request(
      jsonRequest('/api/meal-logs/ml_missing', 'DELETE'),
    )

    expect(res.status).toBe(404)
  })
})
