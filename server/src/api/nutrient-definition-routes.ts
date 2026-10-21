import type { Hono } from 'hono'

import { jsonServerError } from '#api/errors'
import type { NutrientDefinitionRepository } from '#domain/nutrient-definition/types'

export const mountNutrientDefinitionRoutes = (
  app: Hono,
  nutrientDefinitionRepository: NutrientDefinitionRepository,
): void => {
  app.get('/api/nutrient-definitions', async (c) => {
    const result = await nutrientDefinitionRepository.list()
    return result.match(
      (definitions) => c.json(definitions),
      (queryError) => jsonServerError(c, queryError),
    )
  })
}
