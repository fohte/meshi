import type { Context, Hono } from 'hono'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { MealSetDomainError } from '#domain/meal-set/errors'
import type { MealSet, MealSetService } from '#domain/meal-set/index'

const NOT_FOUND_CODES = new Set([
  'meal_set/food_master_not_found',
  'meal_set/not_found',
])
const CLIENT_ERROR_CODES = new Set([
  'meal_set/empty_name',
  'meal_set/empty_items',
  'meal_set/duplicate_food_master',
  'meal_set/invalid_quantity',
])

const mealSetErrorResponse = (
  c: Context,
  error: MealSetDomainError,
): Response => {
  if (NOT_FOUND_CODES.has(error.code)) {
    return c.json({ error: error.message }, 404)
  }
  if (error.code === 'meal_set/duplicate_name') {
    return c.json({ error: error.message }, 409)
  }
  if (!CLIENT_ERROR_CODES.has(error.code)) {
    return jsonServerError(c, error)
  }
  return jsonBadRequest(c, error.message)
}

const mealSetItemBodySchema = z.object({
  foodMasterId: z.string().min(1),
  quantity: z.number().positive(),
})

const mealSetWriteBodySchema = z.object({
  name: z.string(),
  items: z.array(mealSetItemBodySchema).min(1),
})

const toMealSetJson = (mealSet: MealSet) => ({
  id: mealSet.id,
  name: mealSet.name,
  items: mealSet.items.map((item) => ({
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: item.quantity,
    energyKcalPerUnit: item.energyKcalPerUnit,
  })),
  createdAt: mealSet.createdAt.toISOString(),
})

export const mountMealSetRoutes = (
  app: Hono,
  mealSetService: MealSetService,
): void => {
  app.get('/api/meal-sets', async (c) => {
    const result = await mealSetService.list()
    return result.match(
      (mealSets) => c.json(mealSets.map(toMealSetJson)),
      (error) => mealSetErrorResponse(c, error),
    )
  })

  app.post('/api/meal-sets', async (c) => {
    const parsed = await parseJsonBody(c, mealSetWriteBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealSetService.register(parsed.value)
    return result.match(
      (mealSet) => c.json(toMealSetJson(mealSet), 201),
      (error) => mealSetErrorResponse(c, error),
    )
  })

  app.patch('/api/meal-sets/:id', async (c) => {
    const parsed = await parseJsonBody(c, mealSetWriteBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealSetService.update({
      id: c.req.param('id'),
      ...parsed.value,
    })
    return result.match(
      (mealSet) => c.json(toMealSetJson(mealSet)),
      (error) => mealSetErrorResponse(c, error),
    )
  })

  app.delete('/api/meal-sets/:id', async (c) => {
    const result = await mealSetService.delete(c.req.param('id'))
    return result.match(
      () => c.body(null, 204),
      (error) => mealSetErrorResponse(c, error),
    )
  })
}
