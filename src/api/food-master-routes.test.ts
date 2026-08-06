import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

import { mountFoodMasterRoutes } from '#api/food-master-routes'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type { FoodMaster } from '#domain/food-master/types'

const errorResponseSchema = z.object({ error: z.string() })

const buildApp = (foodMasterService: FoodMasterService): Hono => {
  const app = new Hono()
  mountFoodMasterRoutes(app, foodMasterService)
  return app
}

const SAMPLE_FOOD_MASTER: FoodMaster = {
  id: 'fm_new',
  name: 'そば ゆで',
  aliases: [],
  isEstimated: true,
  source: 'composition_table_estimate',
  sourceUrl: null,
  sourceCompositionCode: '01088',
  nutrition: { energy_kcal: 130, protein_g: 4.8 },
  units: [],
  basisQuantity: 100,
  basisUnit: 'g',
  createdAt: new Date('2026-06-18T00:00:00.000Z'),
}

const notStubbed = (name: string): FoodMasterService => ({
  register: () =>
    errAsync(
      new FoodMasterDomainError(
        'persistence_failed',
        `${name}.register not stubbed`,
      ),
    ),
  getById: () =>
    errAsync(
      new FoodMasterDomainError(
        'persistence_failed',
        `${name}.getById not stubbed`,
      ),
    ),
  registerFromComposition: () =>
    errAsync(
      new FoodMasterDomainError(
        'persistence_failed',
        `${name}.registerFromComposition not stubbed`,
      ),
    ),
  findSimilarNames: () =>
    errAsync(
      new FoodMasterDomainError(
        'persistence_failed',
        `${name}.findSimilarNames not stubbed`,
      ),
    ),
})

const jsonRequest = (path: string, body: unknown): Request =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('POST /api/food-masters/from-composition', () => {
  it('registers from a composition code and returns 201', async () => {
    let captured: unknown
    const app = buildApp({
      ...notStubbed('service'),
      registerFromComposition: (input) => {
        captured = input
        return okAsync({
          foodMaster: SAMPLE_FOOD_MASTER,
          compositionName: 'そば',
        })
      },
    })

    const res = await app.request(
      jsonRequest('/api/food-masters/from-composition', {
        compositionCode: '01088',
      }),
    )

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({
      id: 'fm_new',
      name: 'そば ゆで',
      isEstimated: true,
      source: 'composition_table_estimate',
      sourceUrl: null,
      basisQuantity: 100,
      basisUnit: 'g',
      nutritionPerBasis: { energy_kcal: 130, protein_g: 4.8 },
    })
    expect(captured).toEqual({ compositionCode: '01088' })
  })

  it('returns 400 when the body is not valid JSON', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request('/api/food-masters/from-composition', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })

    expect(res.status).toBe(400)
  })

  it('returns 400 when compositionCode is missing', async () => {
    const app = buildApp(notStubbed('service'))

    const res = await app.request(
      jsonRequest('/api/food-masters/from-composition', {}),
    )

    expect(res.status).toBe(400)
    expect(errorResponseSchema.safeParse(await res.json()).success).toBe(true)
  })

  it('returns 404 when the composition code is unknown', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      registerFromComposition: () =>
        errAsync(
          new FoodMasterDomainError(
            'composition_not_found',
            'food_composition not found: 99999',
            { compositionCode: '99999' },
          ),
        ),
    })

    const res = await app.request(
      jsonRequest('/api/food-masters/from-composition', {
        compositionCode: '99999',
      }),
    )

    expect(res.status).toBe(404)
  })

  it('returns 409 when the derived name already exists', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      registerFromComposition: () =>
        errAsync(
          new FoodMasterDomainError(
            'duplicate_name',
            'food_master with name already exists: そば ゆで',
            { name: 'そば ゆで' },
          ),
        ),
    })

    const res = await app.request(
      jsonRequest('/api/food-masters/from-composition', {
        compositionCode: '01088',
      }),
    )

    expect(res.status).toBe(409)
  })

  it('returns 500 on a persistence failure', async () => {
    const app = buildApp({
      ...notStubbed('service'),
      registerFromComposition: () =>
        errAsync(new FoodMasterDomainError('persistence_failed', 'boom')),
    })

    const res = await app.request(
      jsonRequest('/api/food-masters/from-composition', {
        compositionCode: '01088',
      }),
    )

    expect(res.status).toBe(500)
  })
})
