import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import type { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import type { FoodMaster } from '#domain/food-master/types'

const CONFLICT_CODES = new Set(['duplicate_name', 'duplicate_alias'])

const foodMasterErrorResponse = (
  c: Context,
  error: FoodMasterDomainError,
): Response => {
  if (error.code === 'composition_not_found') {
    return c.json({ error: error.message }, 404)
  }
  if (CONFLICT_CODES.has(error.code)) {
    return c.json({ error: error.message }, 409)
  }
  if (error.code === 'persistence_failed') {
    return jsonServerError(c, error)
  }
  return jsonBadRequest(c, error.message)
}

const registerFromCompositionBodySchema = z.object({
  compositionCode: z.string().min(1),
})

const toFoodMasterJson = (foodMaster: FoodMaster) => ({
  id: foodMaster.id,
  name: foodMaster.name,
  isEstimated: foodMaster.isEstimated,
  source: foodMaster.source,
  sourceUrl: foodMaster.sourceUrl,
  basisQuantity: foodMaster.basisQuantity,
  basisUnit: foodMaster.basisUnit,
  nutritionPerBasis: foodMaster.nutrition,
})

export const mountFoodMasterRoutes = (
  app: Hono,
  foodMasterService: FoodMasterService,
): void => {
  app.post('/api/food-masters/from-composition', async (c) => {
    const parsed = await parseJsonBody(c, registerFromCompositionBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await foodMasterService.registerFromComposition({
      compositionCode: parsed.value.compositionCode,
    })
    return result.match(
      ({ foodMaster }) => c.json(toFoodMasterJson(foodMaster), 201),
      (error) => foodMasterErrorResponse(c, error),
    )
  })
}
