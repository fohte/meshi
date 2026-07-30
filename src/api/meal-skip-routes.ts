import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { MEAL_TYPES } from '#domain/meal-log/types'
import type { DomainError } from '#domain/meal-skip/errors'
import type { MealSkipService } from '#domain/meal-skip/meal-skip-service'
import type { MealSkipRow } from '#domain/meal-skip/types'
import { isValidJstCalendarDateString } from '#lib/jst-date'

const NOT_FOUND_CODES = new Set(['meal_skip/not_found'])
const CLIENT_ERROR_CODES = new Set([
  'meal_skip/invalid_date',
  'meal_skip/future_date',
])

const mealSkipErrorResponse = (c: Context, error: DomainError): Response => {
  if (NOT_FOUND_CODES.has(error.code))
    return c.json({ error: error.message }, 404)
  if (CLIENT_ERROR_CODES.has(error.code))
    return jsonBadRequest(c, error.message)
  return jsonServerError(c, error)
}

const paramsSchema = z.object({
  date: z.string().refine(isValidJstCalendarDateString, {
    message: 'date must be a valid YYYY-MM-DD JST calendar date',
  }),
  mealType: z.enum(MEAL_TYPES),
})

const toMealSkipJson = (row: MealSkipRow) => ({
  id: row.id,
  date: row.date,
  mealType: row.mealType,
  createdAt: row.createdAt.toISOString(),
})

export const mountMealSkipRoutes = (
  app: Hono,
  mealSkipService: MealSkipService,
): void => {
  app.put('/api/meal-skips/:date/:mealType', async (c) => {
    const parsed = paramsSchema.safeParse({
      date: c.req.param('date'),
      mealType: c.req.param('mealType'),
    })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    const result = await mealSkipService.record({
      date: parsed.data.date,
      mealType: parsed.data.mealType,
    })
    return result.match(
      (skip) => c.json(toMealSkipJson(skip), 200),
      (error) => mealSkipErrorResponse(c, error),
    )
  })

  app.delete('/api/meal-skips/:date/:mealType', async (c) => {
    const parsed = paramsSchema.safeParse({
      date: c.req.param('date'),
      mealType: c.req.param('mealType'),
    })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }
    const result = await mealSkipService.cancel({
      date: parsed.data.date,
      mealType: parsed.data.mealType,
    })
    return result.match(
      () => c.body(null, 204),
      (error) => mealSkipErrorResponse(c, error),
    )
  })
}
