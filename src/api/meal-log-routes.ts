import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonServerError, parseJsonBody } from '#api/errors'
import {
  type DomainError,
  MealLogItemValidationError,
} from '#domain/meal-log/errors'
import type { MealLogService } from '#domain/meal-log/meal-log-service'
import type { MealLogResult } from '#domain/meal-log/types'
import { MEAL_TYPES } from '#domain/meal-log/types'
import { jstDateSchema } from '#lib/jst-date'

const NOT_FOUND_CODES = new Set([
  'meal_log/food_master_not_found',
  'meal_log/not_found',
])
const CLIENT_ERROR_CODES = new Set([
  'meal_log/future_eaten_date',
  'meal_log/invalid_quantity',
  'meal_log/implausible_quantity',
])

// meal-log-service.ts surfaces user-input mistakes (future eaten_date, a
// non-positive quantity, an unknown food_master_id) as DomainError alongside
// genuine persistence failures — unlike profile-routes.ts, which only ever
// hits genuine DB errors, this needs to route by error code instead of
// collapsing everything to 500.
const mealLogErrorResponse = (c: Context, error: DomainError): Response => {
  const errorBody =
    error instanceof MealLogItemValidationError
      ? { error: error.message, itemIndex: error.itemIndex }
      : { error: error.message }
  if (NOT_FOUND_CODES.has(error.code)) {
    return c.json(errorBody, 404)
  }
  if (CLIENT_ERROR_CODES.has(error.code)) {
    return c.json(errorBody, 400)
  }
  return jsonServerError(c, error)
}

const recordSingleMealLogBodySchema = z.object({
  foodMasterId: z.string().min(1),
  eatenDate: jstDateSchema,
  mealType: z.enum(MEAL_TYPES),
  quantity: z.number().positive(),
})

const recordMealLogItemBodySchema = recordSingleMealLogBodySchema.pick({
  foodMasterId: true,
  quantity: true,
})

const recordBatchMealLogBodySchema = recordSingleMealLogBodySchema
  .pick({ eatenDate: true, mealType: true })
  .extend({ items: z.array(recordMealLogItemBodySchema).min(1) })

const recordMealLogBodySchema = z.preprocess(
  (body: unknown) => {
    const isBatchRequest =
      typeof body === 'object' &&
      body !== null &&
      !Array.isArray(body) &&
      'items' in body
    return {
      type: isBatchRequest ? 'batch' : 'single',
      body,
    }
  },
  z.discriminatedUnion('type', [
    z.object({
      type: z.literal('single'),
      body: recordSingleMealLogBodySchema,
    }),
    z.object({ type: z.literal('batch'), body: recordBatchMealLogBodySchema }),
  ]),
)

const updateMealLogBodySchema = z.object({
  foodMasterId: z.string().min(1).optional(),
  eatenDate: jstDateSchema.optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  quantity: z.number().positive().optional(),
})

const toMealLogJson = (result: MealLogResult) => ({
  id: result.id,
  foodMasterId: result.foodMasterId,
  eatenDate: result.eatenDate,
  mealType: result.mealType,
  quantity: result.quantity,
  nutrition: result.nutrition,
  isEstimated: result.isEstimated,
  nutritionStatus: result.nutritionStatus,
  createdAt: result.createdAt.toISOString(),
})

export const mountMealLogRoutes = (
  app: Hono,
  mealLogService: MealLogService,
): void => {
  app.post('/api/meal-logs', async (c) => {
    const parsed = await parseJsonBody(c, recordMealLogBodySchema)
    if (parsed.isErr()) return parsed.error

    if (parsed.value.type === 'batch') {
      const result = await mealLogService.recordMany(parsed.value.body)
      return result.match(
        (mealLogs) => c.json(mealLogs.map(toMealLogJson), 201),
        (error) => mealLogErrorResponse(c, error),
      )
    }

    const result = await mealLogService.record(parsed.value.body)
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
      ...(parsed.value.eatenDate === undefined
        ? {}
        : { eatenDate: parsed.value.eatenDate }),
      ...(parsed.value.mealType === undefined
        ? {}
        : { mealType: parsed.value.mealType }),
      ...(parsed.value.quantity === undefined
        ? {}
        : { quantity: parsed.value.quantity }),
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
