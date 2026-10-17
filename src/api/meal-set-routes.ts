import type { Context, Hono } from 'hono'
import { okAsync, ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { FoodMasterDomainError } from '#domain/food-master/errors'
import type { FoodMasterService } from '#domain/food-master/service'
import { MealSetDomainError } from '#domain/meal-set/errors'
import type { MealSet, MealSetService } from '#domain/meal-set/index'

const ENERGY_KCAL_CODE = 'energy_kcal'

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
  error: MealSetDomainError | FoodMasterDomainError,
): Response => {
  if (!(error instanceof MealSetDomainError)) {
    return jsonServerError(c, error)
  }
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

const getEnergyKcalByFoodMasterIds = (
  mealSets: ReadonlyArray<MealSet>,
  foodMasterService: Pick<FoodMasterService, 'getById'>,
) => {
  const foodMasterIds = Array.from(
    new Set(
      mealSets.flatMap((mealSet) =>
        mealSet.items.map((item) => item.foodMasterId),
      ),
    ),
  )
  if (foodMasterIds.length === 0) {
    return okAsync(new Map<string, number | null>())
  }

  return ResultAsync.combine(
    foodMasterIds.map((foodMasterId) =>
      foodMasterService.getById(foodMasterId),
    ),
  ).map(
    (foodMasters) =>
      new Map<string, number | null>(
        foodMasterIds.map<[string, number | null]>((foodMasterId, index) => [
          foodMasterId,
          foodMasters[index]?.nutrition[ENERGY_KCAL_CODE] ?? null,
        ]),
      ),
  )
}

const toMealSetJson = (
  mealSet: MealSet,
  energyKcalByFoodMasterId: ReadonlyMap<string, number | null>,
) => ({
  id: mealSet.id,
  name: mealSet.name,
  items: mealSet.items.map((item) => ({
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: item.quantity,
    energyKcalPerUnit: energyKcalByFoodMasterId.get(item.foodMasterId) ?? null,
  })),
  createdAt: mealSet.createdAt.toISOString(),
})

export const mountMealSetRoutes = (
  app: Hono,
  mealSetService: MealSetService,
  foodMasterService: Pick<FoodMasterService, 'getById'>,
): void => {
  app.get('/api/meal-sets', async (c) => {
    const result = await mealSetService
      .list()
      .andThen((mealSets) =>
        getEnergyKcalByFoodMasterIds(mealSets, foodMasterService).map(
          (energyKcalByFoodMasterId) =>
            mealSets.map((mealSet) =>
              toMealSetJson(mealSet, energyKcalByFoodMasterId),
            ),
        ),
      )
    return result.match(
      (mealSets) => c.json(mealSets),
      (error) => mealSetErrorResponse(c, error),
    )
  })

  app.post('/api/meal-sets', async (c) => {
    const parsed = await parseJsonBody(c, mealSetWriteBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealSetService
      .register(parsed.value)
      .andThen((mealSet) =>
        getEnergyKcalByFoodMasterIds([mealSet], foodMasterService).map(
          (energyKcalByFoodMasterId) =>
            toMealSetJson(mealSet, energyKcalByFoodMasterId),
        ),
      )
    return result.match(
      (mealSet) => c.json(mealSet, 201),
      (error) => mealSetErrorResponse(c, error),
    )
  })

  app.patch('/api/meal-sets/:id', async (c) => {
    const parsed = await parseJsonBody(c, mealSetWriteBodySchema)
    if (parsed.isErr()) return parsed.error

    const result = await mealSetService
      .update({ id: c.req.param('id'), ...parsed.value })
      .andThen((mealSet) =>
        getEnergyKcalByFoodMasterIds([mealSet], foodMasterService).map(
          (energyKcalByFoodMasterId) =>
            toMealSetJson(mealSet, energyKcalByFoodMasterId),
        ),
      )
    return result.match(
      (mealSet) => c.json(mealSet),
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
