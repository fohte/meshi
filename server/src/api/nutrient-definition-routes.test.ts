import { Hono } from 'hono'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { mountNutrientDefinitionRoutes } from '#api/nutrient-definition-routes'
import {
  type NutrientDefinition,
  NutrientDefinitionQueryError,
  type NutrientDefinitionRepository,
} from '#domain/nutrient-definition/types'

const buildApp = (repository: NutrientDefinitionRepository): Hono => {
  const app = new Hono()
  mountNutrientDefinitionRoutes(app, repository)
  return app
}

describe('GET /api/nutrient-definitions', () => {
  it('returns the list from the repository', async () => {
    const definitions: NutrientDefinition[] = [
      {
        code: 'energy_kcal',
        displayName: 'エネルギー',
        unit: 'kcal',
        isMajor: true,
        sortOrder: 1,
      },
    ]
    const app = buildApp({ list: () => okAsync(definitions) })

    const res = await app.request('/api/nutrient-definitions')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(definitions)
  })

  it('returns 500 when the repository fails', async () => {
    const app = buildApp({
      list: () => errAsync(new NutrientDefinitionQueryError('boom')),
    })

    const res = await app.request('/api/nutrient-definitions')

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
