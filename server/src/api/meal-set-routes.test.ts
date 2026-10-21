import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountMealSetRoutes } from '#api/meal-set-routes'
import {
  DuplicateMealSetFoodMasterError,
  DuplicateMealSetNameError,
  EmptyMealSetItemsError,
  EmptyMealSetNameError,
  InvalidMealSetQuantityError,
  MealSetFoodMasterNotFoundError,
  MealSetNotFoundError,
  MealSetPersistenceError,
} from '#domain/meal-set/errors'
import type { MealSet, MealSetService } from '#domain/meal-set/index'

const SAMPLE_MEAL_SET: MealSet = {
  id: 'ms_sample',
  name: 'Example set',
  items: [
    {
      foodMasterId: 'fm_alpha',
      foodName: 'Alpha food',
      quantity: 1.5,
      energyKcalPerUnit: 42,
    },
    {
      foodMasterId: 'fm_beta',
      foodName: 'Beta food',
      quantity: 2,
      energyKcalPerUnit: null,
    },
  ],
  createdAt: new Date('2026-08-01T00:00:00.000Z'),
}

const SINGLE_ITEM_MEAL_SET: MealSet = {
  ...SAMPLE_MEAL_SET,
  items: [
    {
      foodMasterId: 'fm_alpha',
      foodName: 'Alpha food',
      quantity: 1.5,
      energyKcalPerUnit: 42,
    },
  ],
}

const buildApp = (mealSetService: MealSetService): Hono => {
  const app = new Hono()
  mountMealSetRoutes(app, mealSetService)
  return app
}

const notStubbed = (name: string): MealSetService => ({
  register: () =>
    errAsync(new MealSetPersistenceError(`${name}.register not stubbed`)),
  list: () => errAsync(new MealSetPersistenceError(`${name}.list not stubbed`)),
  getById: () =>
    errAsync(new MealSetPersistenceError(`${name}.getById not stubbed`)),
  update: () =>
    errAsync(new MealSetPersistenceError(`${name}.update not stubbed`)),
  delete: () =>
    errAsync(new MealSetPersistenceError(`${name}.delete not stubbed`)),
  searchByName: () =>
    errAsync(new MealSetPersistenceError(`${name}.searchByName not stubbed`)),
})

const jsonRequest = (path: string, method: string, body?: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })

const responseSnapshot = async (res: Response) => ({
  status: res.status,
  body: res.status === 204 ? null : await res.json(),
})

const responseWithCaptured = async (res: Response, captured: unknown) => ({
  response: await responseSnapshot(res),
  captured,
})

describe('GET /api/meal-sets', () => {
  it('returns saved sets with food names and per-unit kcal', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      list: () => okAsync([SAMPLE_MEAL_SET]),
    })

    const res = await app.request('/api/meal-sets')

    expect(await responseSnapshot(res)).toEqual({
      status: 200,
      body: [
        {
          id: 'ms_sample',
          name: 'Example set',
          items: [
            {
              foodMasterId: 'fm_alpha',
              foodName: 'Alpha food',
              quantity: 1.5,
              energyKcalPerUnit: 42,
            },
            {
              foodMasterId: 'fm_beta',
              foodName: 'Beta food',
              quantity: 2,
              energyKcalPerUnit: null,
            },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    })
  })

  it('returns a server error when listing sets fails', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      list: () => errAsync(new MealSetPersistenceError('database unavailable')),
    })

    const res = await app.request('/api/meal-sets')

    expect(await responseSnapshot(res)).toEqual({
      status: 500,
      body: { error: 'database unavailable' },
    })
  })
})

describe('POST /api/meal-sets', () => {
  it('creates a set and returns its enriched response', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      register: (input) => {
        captured = input
        return okAsync(SINGLE_ITEM_MEAL_SET)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets', 'POST', {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1.5 }],
      }),
    )

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: {
        status: 201,
        body: {
          id: 'ms_sample',
          name: 'Example set',
          items: [
            {
              foodMasterId: 'fm_alpha',
              foodName: 'Alpha food',
              quantity: 1.5,
              energyKcalPerUnit: 42,
            },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      },
      captured: {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1.5 }],
      },
    })
  })

  it('returns 400 for invalid JSON', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/meal-sets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{invalid',
    })

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'request body must be valid JSON' },
    })
  })

  it('returns 400 when items are empty', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-sets', 'POST', { name: 'Example set', items: [] }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'Too small: expected array to have >=1 items' },
    })
  })

  it('returns 400 when a quantity is not positive', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/meal-sets', 'POST', {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 0 }],
      }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 400,
      body: { error: 'Too small: expected number to be >0' },
    })
  })
})

describe('PATCH /api/meal-sets/:id', () => {
  it('updates the set name and items', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      update: (input) => {
        captured = input
        return okAsync(SINGLE_ITEM_MEAL_SET)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets/ms_sample', 'PATCH', {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1.5 }],
      }),
    )

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: {
        status: 200,
        body: {
          id: 'ms_sample',
          name: 'Example set',
          items: [
            {
              foodMasterId: 'fm_alpha',
              foodName: 'Alpha food',
              quantity: 1.5,
              energyKcalPerUnit: 42,
            },
          ],
          createdAt: '2026-08-01T00:00:00.000Z',
        },
      },
      captured: {
        id: 'ms_sample',
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1.5 }],
      },
    })
  })

  it('returns 404 when the set does not exist', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      update: () => errAsync(new MealSetNotFoundError('ms_missing')),
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets/ms_missing', 'PATCH', {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1 }],
      }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: 'meal_set not found: ms_missing' },
    })
  })
})

describe('DELETE /api/meal-sets/:id', () => {
  it('deletes the set and returns no body', async () => {
    let captured: string | undefined
    const app = buildApp({
      ...notStubbed('service'),
      delete: (id) => {
        captured = id
        return okAsync(undefined)
      },
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets/ms_sample', 'DELETE'),
    )

    expect(await responseWithCaptured(res, captured)).toEqual({
      response: { status: 204, body: null },
      captured: 'ms_sample',
    })
  })

  it('returns 404 when the set does not exist', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      delete: () => errAsync(new MealSetNotFoundError('ms_missing')),
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets/ms_missing', 'DELETE'),
    )

    expect(await responseSnapshot(res)).toEqual({
      status: 404,
      body: { error: 'meal_set not found: ms_missing' },
    })
  })
})

describe('meal-set domain errors', () => {
  it.each([
    { error: new EmptyMealSetNameError(), status: 400 },
    { error: new EmptyMealSetItemsError(), status: 400 },
    {
      error: new DuplicateMealSetFoodMasterError('fm_alpha'),
      status: 400,
    },
    {
      error: new InvalidMealSetQuantityError('fm_alpha', 0),
      status: 400,
    },
    {
      error: new MealSetFoodMasterNotFoundError('fm_missing'),
      status: 404,
    },
    { error: new DuplicateMealSetNameError('Example set'), status: 409 },
    {
      error: new MealSetPersistenceError('database unavailable'),
      status: 500,
    },
  ])('maps $error.code to HTTP $status', async ({ error, status }) => {
    const app = buildApp({
      ...notStubbed('service'),
      register: () => errAsync(error),
    })

    const res = await app.request(
      jsonRequest('/api/meal-sets', 'POST', {
        name: 'Example set',
        items: [{ foodMasterId: 'fm_alpha', quantity: 1 }],
      }),
    )

    expect(await responseSnapshot(res)).toEqual({
      status,
      body: { error: error.message },
    })
  })
})
