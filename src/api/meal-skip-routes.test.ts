import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountMealSkipRoutes } from '#api/meal-skip-routes'
import {
  FutureMealSkipDateError,
  MealSkipNotFoundError,
  MealSkipPersistenceError,
} from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { jstDate } from '#test/jst-date'

const buildApp = (mealSkipService: MealSkipService): Hono => {
  const app = new Hono()
  mountMealSkipRoutes(app, mealSkipService)
  return app
}

const SAMPLE_ROW: MealSkipRow = {
  id: 'skip_1',
  date: jstDate('2026-07-29'),
  mealType: 'breakfast',
  createdAt: new Date('2026-07-29T00:00:00.000Z'),
}

const SAMPLE_JSON = {
  id: 'skip_1',
  date: '2026-07-29',
  mealType: 'breakfast',
  createdAt: '2026-07-29T00:00:00.000Z',
}

const notStubbed = (name: string): MealSkipService => ({
  record: () =>
    errAsync(new MealSkipPersistenceError(`${name}.record not stubbed`)),
  cancel: () =>
    errAsync(new MealSkipPersistenceError(`${name}.cancel not stubbed`)),
  findForDate: () =>
    errAsync(new MealSkipPersistenceError(`${name}.findForDate not stubbed`)),
})

describe('PUT /api/meal-skips/:date/:mealType', () => {
  it('records a skip and returns 200 with the result', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      record: (input) => {
        captured = input
        return okAsync(SAMPLE_ROW)
      },
    })

    const res = await app.request('/api/meal-skips/2026-07-29/breakfast', {
      method: 'PUT',
    })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(SAMPLE_JSON)
    expect(captured).toEqual({ date: '2026-07-29', mealType: 'breakfast' })
  })

  it('returns 400 for a malformed date', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-skips/2026-07-99/breakfast', {
      method: 'PUT',
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 for an invalid mealType', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-skips/2026-07-29/brunch', {
      method: 'PUT',
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 when the service rejects a future date', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      record: () => errAsync(new FutureMealSkipDateError('2099-01-01')),
    })

    const res = await app.request('/api/meal-skips/2026-07-29/breakfast', {
      method: 'PUT',
    })

    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({
      error: 'date must not be in the future: 2099-01-01',
    })
  })

  it('returns 500 when the service fails with a persistence error', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      record: () => errAsync(new MealSkipPersistenceError('boom')),
    })

    const res = await app.request('/api/meal-skips/2026-07-29/breakfast', {
      method: 'PUT',
    })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})

describe('DELETE /api/meal-skips/:date/:mealType', () => {
  it('returns 204 on success', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      cancel: (input) => {
        captured = input
        return okAsync(undefined)
      },
    })

    const res = await app.request('/api/meal-skips/2026-07-29/breakfast', {
      method: 'DELETE',
    })

    expect(res.status).toBe(204)
    expect(captured).toEqual({ date: '2026-07-29', mealType: 'breakfast' })
  })

  it('returns 404 when no skip existed', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      cancel: () =>
        errAsync(new MealSkipNotFoundError('2026-07-29', 'breakfast')),
    })

    const res = await app.request('/api/meal-skips/2026-07-29/breakfast', {
      method: 'DELETE',
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({
      error: 'meal_skip not found: 2026-07-29 breakfast',
    })
  })

  it('returns 400 for a malformed date', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-skips/2026-07-99/breakfast', {
      method: 'DELETE',
    })

    expect(res.status).toBe(400)
  })
})
