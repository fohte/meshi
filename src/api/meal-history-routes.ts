import type { Hono } from 'hono'

import { jsonBadRequest, jsonServerError } from '#api/errors'
import { jstDateRangeQuerySchema } from '#api/jst-date-range'
import { NUTRIENT_CODES } from '#db/seed/nutrient-definitions'
import type { MealHistoryService } from '#domain/meal-history/types'

export const mountMealHistoryRoutes = (
  app: Hono,
  mealHistoryService: MealHistoryService,
): void => {
  app.get('/api/meal-history', async (c) => {
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

    const result = await mealHistoryService.query({
      periodFrom: parsed.data.from,
      periodTo: parsed.data.to,
      // Always requests every nutrient code (not just is_major ones) so the
      // UI's "show all nutrients" table/report views don't need a second call.
      nutrientCodes: NUTRIENT_CODES,
    })

    return result.match(
      (aggregate) =>
        c.json({
          totals: aggregate.totals,
          perDay: aggregate.perDay,
          entries: aggregate.entries.map((entry) => ({
            id: entry.id,
            foodMasterId: entry.foodMasterId,
            foodName: entry.foodName,
            eatenDate: entry.eatenDate,
            mealType: entry.mealType,
            quantity: entry.quantity,
          })),
          hasEstimatedValues: aggregate.hasEstimatedValues,
        }),
      (queryError) => jsonServerError(c, queryError),
    )
  })
}
