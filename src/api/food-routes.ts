import type { Hono } from 'hono'
import { ResultAsync } from 'neverthrow'
import { z } from 'zod'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import type { FoodBrowseService, FoodListItem } from '#domain/food-browse/types'
import type { FoodDetailService } from '#domain/food-detail/types'

const DEFAULT_SEARCH_LIMIT = 20
const DEFAULT_SUGGESTION_LIMIT = 5
const MAX_LIMIT = 50

const searchQuerySchema = z.object({
  q: z.string().optional().default(''),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_SEARCH_LIMIT),
})

const suggestionsQuerySchema = z.object({
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_SUGGESTION_LIMIT),
})

const toListItemJson = (item: FoodListItem) => ({
  foodMasterId: item.foodMasterId,
  compositionCode: item.compositionCode,
  name: item.name,
  isEstimated: item.isEstimated,
  reason: item.reason,
  source: item.source,
  energyKcalPer100g: item.energyKcalPer100g,
})

export const mountFoodRoutes = (
  app: Hono,
  deps: {
    foodBrowseService: FoodBrowseService
    foodDetailService: FoodDetailService
  },
): void => {
  app.get('/api/foods/search', async (c) => {
    const parsed = searchQuerySchema.safeParse({
      q: c.req.query('q'),
      limit: c.req.query('limit'),
    })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await deps.foodBrowseService.search(
      parsed.data.q,
      parsed.data.limit,
    )
    return result.match(
      (items) => c.json({ items: items.map(toListItemJson) }),
      (queryError) => jsonServerError(c, queryError),
    )
  })

  app.get('/api/foods/suggestions', async (c) => {
    const parsed = suggestionsQuerySchema.safeParse({
      limit: c.req.query('limit'),
    })
    if (!parsed.success) {
      return jsonBadRequest(
        c,
        parsed.error.issues.map((issue) => issue.message).join('; '),
      )
    }

    const result = await ResultAsync.combine([
      deps.foodBrowseService.listRecent(parsed.data.limit),
      deps.foodBrowseService.listFrequent(parsed.data.limit),
    ])
    return result.match(
      ([recent, frequent]) =>
        c.json({
          recent: recent.map(toListItemJson),
          frequent: frequent.map(toListItemJson),
        }),
      (queryError) => jsonServerError(c, queryError),
    )
  })

  app.get('/api/foods/:id', async (c) => {
    const result = await deps.foodDetailService.getById(c.req.param('id'))
    return result.match(
      (detail) => {
        if (detail === null) {
          return c.json({ error: 'food not found' }, 404)
        }
        return c.json({
          id: detail.id,
          name: detail.name,
          isEstimated: detail.isEstimated,
          source: detail.source,
          sourceUrl: detail.sourceUrl,
          aliases: detail.aliases,
          nutritionPer100g: detail.nutritionPer100g,
          totalEatenCount: detail.totalEatenCount,
          history: detail.history.map((entry) => ({
            id: entry.id,
            eatenAt: entry.eatenAt.toISOString(),
            mealType: entry.mealType,
            quantity: entry.quantity,
            unit: entry.unit,
          })),
        })
      },
      (queryError) => jsonServerError(c, queryError),
    )
  })
}
