import type { Context, Hono } from 'hono'
import { err, ok, type Result } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError, parseJsonBody } from '#api/errors'
import { jstDateRangeQuerySchema } from '#api/jst-date-range'
import { MEAL_TYPES } from '#domain/meal-log/types'
import {
  type MealPlanDomainError,
  type MealPlanErrorCode,
} from '#domain/meal-plan/errors'
import type { MealPlanService } from '#domain/meal-plan/meal-plan-service'
import type { MealPlan } from '#domain/meal-plan/types'
import { jstDateSchema } from '#lib/jst-date'

type MealPlanHttpStatus = 400 | 404 | 500

const HTTP_STATUS_BY_ERROR_CODE = {
  'meal_plan/invalid_date': 400,
  'meal_plan/past_date': 400,
  'meal_plan/empty_items': 400,
  'meal_plan/duplicate_food_master': 400,
  'meal_plan/invalid_quantity': 400,
  'meal_plan/empty_reason': 400,
  'meal_plan/food_master_not_found': 404,
  'meal_plan/food_name_mismatch': 400,
  'meal_plan/not_found': 404,
  'meal_plan/persistence_failed': 500,
} satisfies Record<MealPlanErrorCode, MealPlanHttpStatus>

const mealPlanErrorResponse = (
  c: Context,
  error: MealPlanDomainError,
): Response => {
  const status = HTTP_STATUS_BY_ERROR_CODE[error.code]
  if (status === 500) return jsonServerError(c, error)
  return c.json({ error: error.message }, status)
}

const paramsSchema = z.object({
  date: jstDateSchema,
  mealType: z.enum(MEAL_TYPES),
})

const writeBodySchema = z.object({
  items: z.array(
    z.object({
      foodMasterId: z.string().min(1),
      foodName: z.string().trim().min(1),
      quantity: z.number(),
    }),
  ),
  reason: z.string().optional(),
})

const parseParams = (
  c: Context,
): Result<z.infer<typeof paramsSchema>, Response> => {
  const parsed = paramsSchema.safeParse({
    date: c.req.param('date'),
    mealType: c.req.param('mealType'),
  })
  if (!parsed.success) {
    return err(
      jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      ),
    )
  }
  return ok(parsed.data)
}

const toMealPlanJson = (plan: MealPlan) => ({
  id: plan.id,
  date: plan.date,
  mealType: plan.mealType,
  reason: plan.reason,
  status: plan.status,
  items: plan.items.map((item) => ({
    foodMasterId: item.foodMasterId,
    foodName: item.foodName,
    quantity: item.quantity,
    energyKcalPerUnit: item.energyKcalPerUnit,
  })),
})

export const mountMealPlanRoutes = (
  app: Hono,
  mealPlanService: MealPlanService,
): void => {
  app.get('/api/meal-plans', async (c) => {
    const parsed = jstDateRangeQuerySchema.safeParse({
      from: c.req.query('from'),
      to: c.req.query('to'),
    })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await mealPlanService.list(parsed.data.from, parsed.data.to)
    return result.match(
      (plans) => c.json(plans.map(toMealPlanJson)),
      (error) => mealPlanErrorResponse(c, error),
    )
  })

  app.put('/api/meal-plans/:date/:mealType', async (c) => {
    const params = parseParams(c)
    if (params.isErr()) return params.error

    const body = await parseJsonBody(c, writeBodySchema)
    if (body.isErr()) return body.error

    const result = await mealPlanService.save({
      ...params.value,
      items: body.value.items,
      ...(body.value.reason === undefined ? {} : { reason: body.value.reason }),
    })
    return result.match(
      (plan) => c.json(toMealPlanJson(plan)),
      (error) => mealPlanErrorResponse(c, error),
    )
  })

  app.post('/api/meal-plans/:id/cancel', async (c) => {
    const parsed = z.uuid().safeParse(c.req.param('id'))
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await mealPlanService.cancel(parsed.data)
    return result.match(
      (plan) => c.json(toMealPlanJson(plan)),
      (error) => mealPlanErrorResponse(c, error),
    )
  })
}
