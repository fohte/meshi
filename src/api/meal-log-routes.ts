import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import type { DomainError } from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult } from '#domain/meal-log/types'
import { MEAL_TYPES } from '#domain/meal-log/types'

const NOT_FOUND_CODES = new Set([
  'meal_log/food_master_not_found',
  'meal_log/not_found',
])
const CLIENT_ERROR_CODES = new Set([
  'meal_log/future_eaten_at',
  'meal_log/invalid_quantity',
  'meal_log/unknown_unit',
  'meal_log/implausible_quantity',
])

// meal-log-service.ts surfaces user-input mistakes (future eaten_at, a
// non-positive quantity, an unresolvable unit, an unknown food_master_id)
// as DomainError alongside genuine persistence failures — unlike
// profile-routes.ts, which only ever hits genuine DB errors, this needs to
// route by error code instead of collapsing everything to 500.
const mealLogErrorResponse = (c: Context, error: DomainError): Response => {
  if (NOT_FOUND_CODES.has(error.code)) {
    return c.json({ error: error.message }, 404)
  }
  if (CLIENT_ERROR_CODES.has(error.code)) {
    return jsonBadRequest(c, error.message)
  }
  return jsonServerError(c, error)
}

const recordMealLogBodySchema = z.object({
  foodMasterId: z.string().min(1),
  eatenAt: z.iso.datetime({ offset: true }),
  mealType: z.enum(MEAL_TYPES).optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1),
  note: z.string().optional(),
})

const updateMealLogBodySchema = z.object({
  foodMasterId: z.string().min(1).optional(),
  eatenAt: z.iso.datetime({ offset: true }).optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  quantity: z.number().positive().optional(),
  unit: z.string().min(1).optional(),
  note: z.string().optional(),
})

const toMealLogJson = (result: MealLogResult) => ({
  id: result.id,
  foodMasterId: result.foodMasterId,
  eatenAt: result.eatenAt.toISOString(),
  mealType: result.mealType,
  quantity: result.quantity,
  unit: result.unit,
  amountGrams: result.amountGrams,
  note: result.note,
  nutrition: result.nutrition,
  isEstimated: result.isEstimated,
  createdAt: result.createdAt.toISOString(),
})

export const mountMealLogRoutes = (
  app: Hono,
  mealLogService: MealLogService,
): void => {
  app.post('/api/meal-logs', async (c) => {
    const parsed = await parseJsonBody(c, recordMealLogBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealLogService.record({
      foodMasterId: parsed.value.foodMasterId,
      eatenAt: new Date(parsed.value.eatenAt),
      quantity: parsed.value.quantity,
      unit: parsed.value.unit,
      ...(parsed.value.mealType === undefined
        ? {}
        : { mealType: parsed.value.mealType }),
      ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
    })
    return result.match(
      (mealLog) => c.json(toMealLogJson(mealLog), 201),
      (error) => mealLogErrorResponse(c, error),
    )
  })

  app.patch('/api/meal-logs/:id', async (c) => {
    const parsed = await parseJsonBody(c, updateMealLogBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealLogService.update({
      id: c.req.param('id'),
      ...(parsed.value.foodMasterId === undefined
        ? {}
        : { foodMasterId: parsed.value.foodMasterId }),
      ...(parsed.value.eatenAt === undefined
        ? {}
        : { eatenAt: new Date(parsed.value.eatenAt) }),
      ...(parsed.value.mealType === undefined
        ? {}
        : { mealType: parsed.value.mealType }),
      ...(parsed.value.quantity === undefined
        ? {}
        : { quantity: parsed.value.quantity }),
      ...(parsed.value.unit === undefined ? {} : { unit: parsed.value.unit }),
      ...(parsed.value.note === undefined ? {} : { note: parsed.value.note }),
    })
    return result.match(
      (mealLog) => c.json(toMealLogJson(mealLog)),
      (error) => mealLogErrorResponse(c, error),
    )
  })

  app.delete('/api/meal-logs/:id', async (c) => {
    const result = await mealLogService.delete(c.req.param('id'))
    return result.match(
      () => c.body(null, 204),
      (error) => mealLogErrorResponse(c, error),
    )
  })
}
