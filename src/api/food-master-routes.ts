import type { Context, Hono } from 'hono'
import { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError } from '#api/errors'
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
  nutritionPer100g: foodMaster.nutrition,
})

export const mountFoodMasterRoutes = (
  app: Hono,
  foodMasterService: FoodMasterService,
): void => {
  app.post('/api/food-masters/from-composition', async (c) => {
    const bodyResult = await ResultAsync.fromPromise(
      c.req.json(),
      () => new Error('request body must be valid JSON'),
    )
    if (bodyResult.isErr()) {
      return jsonBadRequest(c, bodyResult.error.message)
    }

    const parsed = registerFromCompositionBodySchema.safeParse(bodyResult.value)
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await foodMasterService.registerFromComposition(
      parsed.data.compositionCode,
    )
    return result.match(
      (foodMaster) => c.json(toFoodMasterJson(foodMaster), 201),
      (error) => foodMasterErrorResponse(c, error),
    )
  })
}
